#!/usr/bin/env python3
"""Extract three-letter roots and lemmas from siddur forms using a DictaLM model.

Defaults to dicta-il/dictalm-rab-7b (foundation model trained on rabbinic texts).
The model is prompted with a simple JSON completion request. Results are cached
in .cache/root-extract-<model>.json and a summary is written to
reports/root-extract.md.

    # dev server must be running
    python scripts/extract-roots.py --limit 50

For a smaller/faster model:
    python scripts/extract-roots.py --hf-model dicta-il/DictaLM-3.0-1.7B-Instruct --limit 50
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

SIDDUR_URL = os.environ.get('SIDDUR_URL', 'http://localhost:3000')
DEFAULT_MODEL = 'dicta-il/dictalm-rab-7b'
CACHE_DIR = Path('.cache')
REPORT_FILE = Path('reports/root-extract.md')

PROMPT = """Hebrew word: {word}
Sentence context: {sentence}
Return only JSON with the three-letter root (shoresh) and dictionary lemma:
{{"root": "...", "lemma": "..."}}"""


def consonantal(word: str) -> str:
    """Bare Hebrew letters, finals folded to regular forms."""
    finals = {'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ'}
    letters = ''.join(
        ch for ch in word
        if 'א' <= ch <= 'ת'
    )
    return ''.join(finals.get(ch, ch) for ch in letters)


def fetch_rows(url: str) -> list[dict]:
    try:
        with urllib.request.urlopen(f'{url}/api/prefixes', timeout=120) as r:
            return json.load(r)['rows']
    except Exception as e:
        sys.exit(f'Could not load {url}/api/prefixes ({e}). Start `npm run dev`, or set SIDDUR_URL.')


def section_text(ref: str, para: int, texts: dict, siddur_url: str) -> list[str] | None:
    if ref not in texts:
        try:
            import urllib.parse
            q = urllib.parse.quote(ref, safe='')
            with urllib.request.urlopen(f'{siddur_url}/api/siddur/text?ref={q}', timeout=60) as r:
                texts[ref] = json.load(r)
        except Exception:
            texts[ref] = None
    paras = (texts.get(ref) or {}).get('paragraphs') or []
    p = paras[para - 1] if 0 < para <= len(paras) else None
    if not p:
        return None
    return [w for s in p.get('segments', []) if s.get('type') == 'words' for w in s.get('words', [])]


def context_sentence(loc: dict, texts: dict, siddur_url: str) -> str:
    ref = loc.get('ref')
    para = loc.get('paragraph', 0)
    want = consonantal(loc['word'])
    words = section_text(ref, para, texts, siddur_url) if ref and para else None
    if not words:
        return loc['word']
    try:
        idx = next(i for i, w in enumerate(words) if consonantal(w) == want)
    except StopIteration:
        return loc['word']
    # slice a window of up to 7 words centered on the target
    lo = max(0, idx - 3)
    hi = min(len(words), idx + 4)
    return ' '.join(words[lo:hi])


def parse_json(raw: str) -> dict:
    m = re.search(r'\{.*\}', raw, re.S)
    return json.loads(m.group(0)) if m else {}


def load_model(model_id: str, device_pref: str):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if device_pref == 'auto':
        device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    else:
        device = device_pref

    print(f'Loading {model_id} on {device}…', file=sys.stderr)
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=torch.float16 if device != 'cpu' else torch.float32,
        trust_remote_code=True,
    ).to(device)
    model.eval()
    return model, tokenizer, device


def predict(model, tokenizer, device: str, word: str, sentence: str) -> dict:
    prompt = PROMPT.format(word=word, sentence=sentence)
    inputs = tokenizer(prompt, return_tensors='pt').to(device)
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=80, do_sample=False)
    raw = tokenizer.decode(out[0][inputs['input_ids'].shape[1]:], skip_special_tokens=True)
    try:
        return parse_json(raw)
    except Exception as e:
        return {'error': str(e), 'raw': raw}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--hf-model', default=DEFAULT_MODEL, help='Hugging Face model id')
    ap.add_argument('--siddur-url', default=SIDDUR_URL)
    ap.add_argument('--device', choices=['auto', 'mps', 'cpu'], default='auto')
    ap.add_argument('--limit', type=int, help='only process first N forms')
    ap.add_argument('--no-cache', action='store_true')
    args = ap.parse_args()

    rows = fetch_rows(args.siddur_url)
    todo = rows[:args.limit] if args.limit else rows

    safe_model = args.hf_model.replace('/', '_')
    cache_path = CACHE_DIR / f'root-extract-{safe_model}.json'
    cache: dict = {}
    if not args.no_cache and cache_path.exists():
        cache = json.loads(cache_path.read_text())

    need = [r for r in todo if r['word'] not in cache]
    if need:
        model, tokenizer, device = load_model(args.hf_model, args.device)
        texts: dict = {}
        for n, r in enumerate(need, 1):
            loc = r['locations'][0] if r.get('locations') else {'word': r['word']}
            sentence = context_sentence(loc, texts, args.siddur_url)
            data = predict(model, tokenizer, device, loc['word'], sentence)
            cache[r['word']] = data
            if n % 10 == 0:
                CACHE_DIR.mkdir(exist_ok=True)
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
            print(f'{n}/{len(need)} {r["word"]} → {data}', file=sys.stderr)
        CACHE_DIR.mkdir(exist_ok=True)
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=1))

    # Aggregate
    root_groups: dict[str, list[str]] = {}
    lemma_groups: dict[str, list[str]] = {}
    for r in todo:
        data = cache.get(r['word'], {})
        root = data.get('root')
        lemma = data.get('lemma')
        if root:
            root_groups.setdefault(root, []).append(r['word'])
        if lemma:
            lemma_groups.setdefault(lemma, []).append(r['word'])

    lines = ['# Root and lemma extraction', '']
    lines.append(f'- Model: `{args.hf_model}`')
    lines.append(f'- Forms processed: {len(todo)}')
    lines.append(f'- Forms with root: {sum(1 for r in todo if cache.get(r["word"], {}).get("root"))}')
    lines.append(f'- Forms with lemma: {sum(1 for r in todo if cache.get(r["word"], {}).get("lemma"))}')
    lines.append(f'- Unique roots: {len(root_groups)}')
    lines.append(f'- Unique lemmas: {len(lemma_groups)}')
    lines.append('')
    lines.append('## Largest root groups')
    for root, forms in sorted(root_groups.items(), key=lambda x: -len(x[1]))[:20]:
        preview = ', '.join(forms[:8])
        lines.append(f'- **{root}** ({len(forms)} forms): {preview}{" …" if len(forms) > 8 else ""}')
    lines.append('')
    lines.append('## Largest lemma groups')
    for lemma, forms in sorted(lemma_groups.items(), key=lambda x: -len(x[1]))[:20]:
        preview = ', '.join(forms[:8])
        lines.append(f'- **{lemma}** ({len(forms)} forms): {preview}{" …" if len(forms) > 8 else ""}')
    lines.append('')
    lines.append('## Sample outputs')
    for r in todo[:20]:
        data = cache.get(r['word'], {})
        lines.append(f'- `{r["word"]}` → {json.dumps(data, ensure_ascii=False)}')

    REPORT_FILE.parent.mkdir(exist_ok=True)
    REPORT_FILE.write_text('\n'.join(lines) + '\n')
    print(f'Wrote {REPORT_FILE}', file=sys.stderr)


if __name__ == '__main__':
    main()
