#!/usr/bin/env python3
"""
Evaluate LM backends against the rules + manual overrides for siddur prefix
classification (the same gold set edited on the /prefixes page).

    # dev server must be running (defaults to :3000)
    SIDDUR_URL=http://localhost:3001 npm run prefixes:eval -- --backend all

Backends:
    rules    free baseline — the row's `auto` classification from classifyPrefix
    joint    dicta-il/dictabert-joint (pip install transformers torch; ~500MB,
             runs on CPU/MPS, trust_remote_code). Input is UNvocalized — niqqud
             is stripped before inference.
    ollama   an instruct LLM over the POINTED sentence via a local Ollama
             server (ollama pull hf.co/dicta-il/DictaLM-3.0-1.7B-Instruct-GGUF)

Gold: rows whose `override` is set, collapsed to binary prefix / non-prefix
(root + formative). Backend predictions are cached per lexiconKey in
.cache/prefix-eval-<backend>.json so interrupted runs resume. Writes
reports/prefix-model-eval.md.
"""

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

SIDDUR_URL = os.environ.get('SIDDUR_URL', 'http://localhost:3000')
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
DEFAULT_OLLAMA_MODEL = 'hf.co/dicta-il/dictalm2.0-instruct-GGUF'
DEFAULT_HF_MODEL = 'dicta-il/DictaLM-3.0-1.7B-Instruct'  # ~3.4GB fp16, runs on MPS
CACHE_DIR = Path('.cache')
OUT_FILE = Path('reports/prefix-model-eval.md')
MAQAF = '־'
FINALS = {'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ'}


def is_mark(ch: str) -> bool:
    return unicodedata.category(ch).startswith('M')


def is_edge(ch: str) -> bool:
    # \p{P}\p{S} + whitespace — same edges as cleanHebrewWord().
    return ch.isspace() or unicodedata.category(ch)[0] in 'PS'


def clean_hebrew(word: str) -> str:
    """Port of cleanHebrewWord(): strip edge punctuation/symbols/whitespace."""
    start, end = 0, len(word)
    while start < end and is_edge(word[start]):
        start += 1
    while end > start and is_edge(word[end - 1]):
        end -= 1
    return word[start:end]


def consonantal(word: str) -> str:
    """Bare Hebrew letters, finals folded — port of consonantalKey()."""
    letters = ''.join(
        ch for ch in unicodedata.normalize('NFKD', word)
        if not is_mark(ch) and not is_edge(ch) and 'א' <= ch <= 'ת'
    )
    return ''.join(FINALS.get(ch, ch) for ch in letters)


def model_input(word: str) -> str:
    """Unvocalized surface for dictabert input (letters, finals kept as written)."""
    return ''.join(
        ch for ch in unicodedata.normalize('NFKD', word) if not is_mark(ch)
    )


# --- data -----------------------------------------------------------------


def fetch_rows(url: str) -> list[dict]:
    try:
        with urllib.request.urlopen(f'{url}/api/prefixes', timeout=120) as r:
            return json.load(r)['rows']
    except Exception as e:
        sys.exit(
            f'Could not load {url}/api/prefixes ({e}).\n'
            'Start `npm run dev`, or set SIDDUR_URL.'
        )


def sentence_parts(loc: dict) -> list[str]:
    """(words before) + (target word, maqaf-split) + (words after), ellipses dropped."""
    parts = []
    for text in (loc['before'], loc['word'], loc['after']):
        for tok in text.split():
            if tok in ('…', '...'):
                continue
            parts.extend(p for p in tok.split(MAQAF) if p)
    return parts


def target_index(row: dict, parts: list[str]) -> int | None:
    """Index of the gold form inside sentence_parts (maqaf parts expanded)."""
    before = sum(
        len(tok.split(MAQAF))
        for tok in row['locations'][0]['before'].split()
        if tok not in ('…', '...')
    )
    want = consonantal(row['word'])
    for i in range(before, len(parts)):
        if consonantal(parts[i]) == want:
            return i
    return None


def gold_label(override: str) -> str:
    return 'prefix' if override == 'prefix' else 'non-prefix'


SENT_END = tuple('׃:.!?')
_TRAIL = '"״\'׳)]} ,…'


def ends_sentence(token: str) -> bool:
    """Token ends a sentence: sof pasuq (׃, or ASCII ':' as used in these texts), period, etc."""
    tail = token.rstrip(_TRAIL)
    return bool(tail) and tail.endswith(SENT_END)


def context_sentence(loc: dict, texts: dict, siddur_url: str) -> str | None:
    """Full sentence containing the target word, from the section's paragraph text.

    Fetches /api/siddur/text?ref= once per ref into `texts`; flattens the
    paragraph's 'words' segments, finds the token matching loc['word']
    (consonantal equality), expands to sentence boundaries. None → caller
    falls back to the ±5-word window.
    """
    ref = loc.get('ref')
    if not ref:
        return None
    if ref not in texts:
        try:
            q = urllib.parse.quote(ref, safe='')
            with urllib.request.urlopen(f'{siddur_url}/api/siddur/text?ref={q}', timeout=60) as r:
                texts[ref] = json.load(r)
        except Exception:
            texts[ref] = None
    paras = (texts.get(ref) or {}).get('paragraphs') or []
    p = paras[loc['paragraph'] - 1] if 0 < loc.get('paragraph', 0) <= len(paras) else None
    if not p:
        return None
    words = [w for s in p.get('segments', []) if s.get('type') == 'words' for w in s.get('words', [])]
    if not words:
        return None
    want = consonantal(loc['word'])
    ti = next((i for i, w in enumerate(words) if consonantal(w) == want), None)
    if ti is None:
        return None
    lo = ti
    while lo > 0 and not ends_sentence(words[lo - 1]):
        lo -= 1
    hi = ti
    while hi < len(words) - 1 and not ends_sentence(words[hi]):
        hi += 1
    return ' '.join(words[lo:hi + 1])


def context_for(loc: dict, context: str, texts: dict, siddur_url: str) -> str:
    if context == 'sentence':
        sent = context_sentence(loc, texts, siddur_url)
        if sent:
            return sent
    return ' '.join(sentence_parts(loc))


# --- backend: dictabert-joint ---------------------------------------------


def load_joint():
    from transformers import AutoModel, AutoTokenizer

    model_id = 'dicta-il/dictabert-joint'
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    # predict(..., 'json') composes every head (syntax MST runs unconditionally),
    # so none can be disabled at load time.
    model = AutoModel.from_pretrained(model_id, trust_remote_code=True)
    model.eval()
    return model, tokenizer


def align_index(my_parts: list[str], model_tokens: list[dict], i: int) -> int | None:
    """Map my token index to the model token covering it (consonantal merge-walk).

    The model may merge punctuation into neighbors or split a token; walk both
    sequences accumulating consonant strings until they match.
    """
    mine = [consonantal(p) for p in my_parts]
    theirs = [consonantal(t.get('token', '')) for t in model_tokens]
    mi = ti = 0
    while mi < len(mine) and ti < len(theirs):
        if mi == i and mine[mi] == theirs[ti]:
            return ti
        # merge the shorter side forward
        if mine[mi] == theirs[ti]:
            mi += 1
            ti += 1
        elif len(mine[mi]) < len(theirs[ti]):
            merge = mine[mi]
            mi += 1
            while mi < len(mine) and len(merge) < len(theirs[ti]):
                merge += mine[mi]
                mi += 1
            if merge != theirs[ti]:
                return None
        else:
            merge = theirs[ti]
            ti += 1
            while ti < len(theirs) and len(merge) < len(mine[mi]):
                merge += theirs[ti]
                ti += 1
            if merge != mine[mi]:
                return None
    return None


def joint_predictions(rows: list[dict], limit: int | None) -> dict[str, dict]:
    model, tokenizer = load_joint()
    todo = [r for r in rows if r['locations']][: limit or None]
    sentences, metas = [], []
    for r in todo:
        parts = [model_input(clean_hebrew(p)) for p in sentence_parts(r['locations'][0])]
        parts = [p for p in parts if consonantal(p)]
        metas.append((parts, target_index(r, parts)))
        sentences.append(' '.join(parts))

    preds: dict[str, dict] = {}
    B = 16
    for off in range(0, len(sentences), B):
        batch = sentences[off : off + B]
        try:
            out = model.predict(batch, tokenizer, output_style='json')
        except Exception as e:
            print(f'  joint predict failed on batch {off // B}: {e}', file=sys.stderr)
            out = [None] * len(batch)
        for r, (parts, ti), sent_out in zip(todo[off : off + B], metas[off : off + B], out):
            pred = {'label': None, 'detail': 'no model output'}
            if sent_out and ti is not None:
                mt = align_index(parts, sent_out.get('tokens', []), ti)
                if mt is not None:
                    tok = sent_out['tokens'][mt]
                    morph = tok.get('morph', {})
                    prefixes = morph.get('prefixes') or []
                    seg = tok.get('seg') or []
                    pred = {
                        'seg': seg,
                        'prefixes': prefixes,
                        'lex': tok.get('lex'),
                        'pos': morph.get('pos'),
                        'detail': f"seg={'+'.join(seg)} lex={tok.get('lex')} pos={morph.get('pos')} prefixes={prefixes}",
                    }
                else:
                    pred['detail'] = 'alignment failed'
            elif ti is None:
                pred['detail'] = 'target not found in context'
            preds[r['word']] = pred
    return preds


# --- backend: ollama --------------------------------------------------------

PROMPT = """You are a Hebrew morphological analyzer for liturgical (biblical/rabbinic) Hebrew.

Sentence (pointed Hebrew): {sentence}

Analyze the word: {word}

Is its FIRST letter a separable grammatical prefix — conjunction ו ("and"), relative ש ("that"),
preposition ב/כ/ל/מ ("in/like/to/from"), or definite article ה ("the") — or is it a root letter of the word itself?
Use the vowel pointing and the sentence context. Reply with JSON only:
{{"prefixes": ["<prefix letters, outermost first>"], "stem": "<word without prefixes>", "lemma": "<dictionary form>", "is_prefix": true}}"""


def parse_llm_json(raw: str) -> dict:
    """Extract {prefixes, stem, lemma, is_prefix} from an LLM response."""
    m = re.search(r'\{.*\}', raw, re.S)
    return json.loads(m.group(0)) if m else {}


def llm_pred(data: dict) -> dict:
    is_prefix = bool(data.get('is_prefix')) or bool(data.get('prefixes'))
    return {
        'label': 'prefix' if is_prefix else 'non-prefix',
        'seg': data.get('prefixes'),
        'lex': data.get('lemma'),
        'stem': data.get('stem'),
        'detail': f"prefixes={data.get('prefixes')} stem={data.get('stem')} lemma={data.get('lemma')}",
    }


def ollama_predictions(rows: list[dict], model: str, ollama_url: str, limit: int | None,
                       context: str = 'window', siddur_url: str = SIDDUR_URL,
                       on_row=None) -> dict[str, dict]:
    preds: dict[str, dict] = {}
    texts: dict = {}  # ref → /api/siddur/text response (for --context sentence)
    todo = [r for r in rows if r['locations']][: limit or None]
    for n, r in enumerate(todo, 1):
        loc = r['locations'][0]
        sentence = context_for(loc, context, texts, siddur_url)
        body = {
            'model': model,
            'prompt': PROMPT.format(sentence=sentence, word=loc['word']),
            'stream': False,
            'format': 'json',
            'options': {'temperature': 0},
        }
        pred = {'label': None, 'detail': ''}
        try:
            req = urllib.request.Request(
                f'{ollama_url}/api/generate',
                data=json.dumps(body).encode(),
                headers={'Content-Type': 'application/json'},
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = json.load(resp)['response']
            pred = llm_pred(parse_llm_json(raw))
        except Exception as e:
            pred['detail'] = f'ollama error: {e}'
            if n == 1:
                print('  ollama unreachable — is `ollama serve` running?', file=sys.stderr)
                break
        preds[r['word']] = pred
        if on_row:
            on_row(preds)
        print(f'  ollama {n}/{len(todo)} {r["word"]} → {pred["label"]}', file=sys.stderr)
    return preds


def dictalm_predictions(rows: list[dict], model_id: str, limit: int | None,
                        context: str = 'window', siddur_url: str = SIDDUR_URL,
                        on_row=None) -> dict[str, dict]:
    """DictaLM instruct via transformers — pointed text, deterministic decode."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        dtype=torch.float16 if device == 'mps' else torch.float32,
    ).to(device)
    model.eval()

    preds: dict[str, dict] = {}
    texts: dict = {}  # ref → /api/siddur/text response (for --context sentence)
    todo = [r for r in rows if r['locations']][: limit or None]
    for n, r in enumerate(todo, 1):
        loc = r['locations'][0]
        sentence = context_for(loc, context, texts, siddur_url)
        messages = [{'role': 'user', 'content': PROMPT.format(sentence=sentence, word=loc['word'])}]
        pred = {'label': None, 'detail': ''}
        try:
            enc = tokenizer.apply_chat_template(
                messages, add_generation_prompt=True, return_tensors='pt', return_dict=True
            ).to(device)
            with torch.no_grad():
                out = model.generate(**enc, max_new_tokens=150, do_sample=False)
            raw = tokenizer.decode(out[0][enc['input_ids'].shape[1]:], skip_special_tokens=True)
            pred = llm_pred(parse_llm_json(raw))
        except Exception as e:
            pred['detail'] = f'dictalm error: {e!r}'
        preds[r['word']] = pred
        if on_row:
            on_row(preds)
        print(f'  dictalm {n}/{len(todo)} {r["word"]} → {pred["label"]}', file=sys.stderr)
    return preds


# --- cache + scoring --------------------------------------------------------


def load_cache(name: str) -> dict:
    path = CACHE_DIR / f'prefix-eval-{name}.json'
    return json.loads(path.read_text()) if path.exists() else {}


def save_cache(name: str, data: dict) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    (CACHE_DIR / f'prefix-eval-{name}.json').write_text(json.dumps(data, ensure_ascii=False, indent=1))


def label_of(name: str, pred: dict) -> str | None:
    """Binary label from a cached prediction.

    joint: either head can assert a proclitic — `morph.prefixes` (POS of each
    prefix) or `seg` (the segmentation itself) splitting >1 part. The two heads
    sometimes disagree (seg=ו+חרה with prefixes=[]), so seg is authoritative.
    """
    if name == 'joint':
        # Successful predictions store 'seg'; failures only have label=None + detail.
        if 'seg' not in pred:
            return None
        prefixes = pred.get('prefixes') or []
        seg = pred.get('seg') or []
        return 'prefix' if prefixes or len(seg) > 1 else 'non-prefix'
    return pred.get('label')


def accuracy(name: str, gold: list[dict], preds: dict[str, dict]) -> tuple[int, int, int]:
    """(correct, scored, unscored) — alignment/API failures are unscored, not wrong."""
    scored = [(r, label_of(name, preds.get(r['word'], {}))) for r in gold]
    hit = sum(1 for r, p in scored if p is not None and p == gold_label(r['override']))
    tot = sum(1 for _, p in scored if p is not None)
    return hit, tot, len(scored) - tot


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--backend', choices=['rules', 'joint', 'ollama', 'dictalm', 'all'], default='all')
    ap.add_argument('--ollama-model', default=DEFAULT_OLLAMA_MODEL)
    ap.add_argument('--ollama-url', default=OLLAMA_URL)
    ap.add_argument('--hf-model', default=DEFAULT_HF_MODEL,
                    help='HF instruct model for --backend dictalm (e.g. dicta-il/dictalm2.0-instruct for 7B)')
    ap.add_argument('--siddur-url', default=SIDDUR_URL)
    ap.add_argument('--limit', type=int, default=None, help='cap gold rows evaluated per backend')
    ap.add_argument('--context', choices=['window', 'sentence'], default='window',
                    help='LLM input: ±5-word window, or full sentence reconstructed via /api/siddur/text')
    ap.add_argument('--no-cache', action='store_true')
    ap.add_argument('--all-forms', action='store_true',
                    help='predict every report row (not just gold) and emit a review queue of non-unanimous votes')
    args = ap.parse_args()

    rows = fetch_rows(args.siddur_url)
    gold = [r for r in rows if r.get('override')]
    pool = rows if args.all_forms else gold
    print(f'{len(rows)} rows, {len(gold)} with overrides (gold set)'
          + (f', predicting {len(pool)}' if args.all_forms else ''))

    results: dict[str, dict[str, dict]] = {'rules': {r['word']: {'label': gold_label(r['auto']) if r.get('auto') else None} for r in rows}}
    if args.backend in ('joint', 'all'):
        cache = {} if args.no_cache else load_cache('joint')
        need = [r for r in pool if r['word'] not in cache]
        if need:
            print(f'joint: predicting {len(need)} forms…', file=sys.stderr)
            cache.update(joint_predictions(need, args.limit))
            save_cache('joint', cache)
        results['joint'] = cache
    if args.backend in ('ollama', 'all'):
        cname = 'ollama' if args.context == 'window' else f'ollama-{args.context}'
        cache = {} if args.no_cache else load_cache(cname)
        need = [r for r in pool if r['word'] not in cache]
        if need:
            print(f'{cname}: predicting {len(need)} forms…', file=sys.stderr)
            cache.update(ollama_predictions(
                need, args.ollama_model, args.ollama_url, args.limit,
                context=args.context, siddur_url=args.siddur_url,
                on_row=lambda p: save_cache(cname, {**cache, **p})))
            save_cache(cname, cache)
        results[cname] = cache
    if args.backend in ('dictalm', 'all'):
        cname = 'dictalm' if args.context == 'window' else f'dictalm-{args.context}'
        cache = {} if args.no_cache else load_cache(cname)
        need = [r for r in pool if r['word'] not in cache]
        if need:
            print(f'{cname}: predicting {len(need)} forms…', file=sys.stderr)
            cache.update(dictalm_predictions(
                need, args.hf_model, args.limit,
                context=args.context, siddur_url=args.siddur_url,
                on_row=lambda p: save_cache(cname, {**cache, **p})))
            save_cache(cname, cache)
        results[cname] = cache
    # Unreachable/errored backends leave empty caches — exclude from stats.
    results = {n: p for n, p in results.items() if n == 'rules' or p}

    evald = gold[: args.limit or None]
    lines = ['# Prefix classification — model eval', '',
             f'{len(evald)} gold forms (manual overrides). Binary: prefix vs. non-prefix (root+formative).', '']
    for name, preds in results.items():
        hit, tot, skipped = accuracy(name, evald, preds)
        lines.append(
            f'- **{name}**: {hit}/{tot} correct ({100 * hit / tot:.0f}%){f" · {skipped} skipped" if skipped else ""}'
            if tot else f'- **{name}**: no predictions'
        )
    models = [n for n in results if n != 'rules']
    if models:
        for model_name in models:
            uh = ut = ih = dis = rr = mr = 0
            for r in evald:
                g = gold_label(r['override'])
                rl = label_of('rules', results['rules'].get(r['word'], {}))
                ml = label_of(model_name, results[model_name].get(r['word'], {}))
                if rl is None or ml is None:
                    continue
                ut += 1
                union = 'prefix' if 'prefix' in (rl, ml) else 'non-prefix'
                inter = 'prefix' if rl == ml == 'prefix' else 'non-prefix'
                uh += union == g
                ih += inter == g
                if rl != ml:
                    dis += 1
                    rr += rl == g
                    mr += ml == g
            if ut:
                lines += [
                    '',
                    f'Ensemble rules+{model_name} over {ut} rows where both scored:',
                    f'- **union** (either says prefix): {uh}/{ut} ({100 * uh / ut:.0f}%)',
                    f'- **intersection** (agree-on-prefix, else non-prefix): {ih}/{ut} ({100 * ih / ut:.0f}%)',
                    f'- **disagree** on {dis} rows → rules right {rr}, {model_name} right {mr}, neither {dis - rr - mr}',
                ]
        if len(results) >= 3:
            names = list(results)
            tie_name = next(n for n in names if n not in ('rules', 'joint'))
            mh = mt = d_tie = d_correct = 0
            for r in evald:
                labs = {n: label_of(n, results[n].get(r['word'], {})) for n in names}
                if any(v is None for v in labs.values()):
                    continue
                mt += 1
                g = gold_label(r['override'])
                maj = 'prefix' if sum(v == 'prefix' for v in labs.values()) >= 2 else 'non-prefix'
                mh += maj == g
                if labs['rules'] != labs['joint']:
                    d_tie += 1
                    d_correct += labs[tie_name] == g
            if mt:
                lines += [
                    '',
                    f'Majority vote over {mt} rows where all {len(names)} scored:',
                    f'- **majority**: {mh}/{mt} ({100 * mh / mt:.0f}%)',
                    f'- rules⊕joint disagree on {d_tie} rows → {tie_name} tiebreak right {d_correct}',
                ]
    lines.append('')
    lines.append('## Disagreements vs. gold')
    lines.append('')
    names = list(results)
    for r in evald:
        g = gold_label(r['override'])
        marks = {n: results[n].get(r['word'], {}) for n in names}
        labels = {n: label_of(n, marks[n]) for n in names}
        if all(l in (None, g) for l in labels.values()):
            continue
        loc = r['locations'][0] if r['locations'] else {}
        ctx = f"{loc.get('before', '')} **{loc.get('word', '')}** {loc.get('after', '')}".strip()
        lines.append(f"- **{r['word']}** (gold {r['override']}, rules `{r['auto']}`): "
                     + ', '.join(f"{n}={labels[n]} ({marks[n].get('detail', '')})" for n in names if n != 'rules'))
        if ctx:
            lines.append(f'  - {ctx}')
    queue_n = None
    if args.all_forms and len(results) >= 3:
        names = list(results)
        queue = []
        for r in rows:
            if r.get('override'):
                continue  # already human-decided
            labs = {n: label_of(n, results[n].get(r['word'], {})) for n in names}
            distinct = {v for v in labs.values() if v is not None}
            if len(distinct) > 1:
                queue.append((r, labs))
        queue.sort(key=lambda x: -(x[0].get('count') or 0))
        queue_n = len(queue)
        lines += [
            '',
            f'## Review queue — {queue_n} non-unanimous forms of {len(rows)}',
            '',
            'Unanimous votes auto-accepted; rows with overrides excluded. Sorted by frequency.', '',
        ]
        for r, labs in queue:
            loc = r['locations'][0] if r['locations'] else {}
            ctx = f"{loc.get('before', '')} **{loc.get('word', '')}** {loc.get('after', '')}".strip()
            lines.append(f"- **{r['word']}** ×{r.get('count', '?')} — "
                         + ', '.join(f"{n}={labs[n]}" for n in names))
            if ctx:
                lines.append(f'  - {ctx}')
    OUT_FILE.parent.mkdir(exist_ok=True)
    OUT_FILE.write_text('\n'.join(lines))
    print('\n'.join(lines[: lines.index('## Disagreements vs. gold')]))
    if queue_n is not None:
        print(f'Review queue: {queue_n} forms')
    print(f'→ {OUT_FILE}')


if __name__ == '__main__':
    main()
