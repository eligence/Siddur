#!/usr/bin/env python3
"""Merge cached model predictions into server/assets/segmentation.json.

Reads .cache/prefix-eval-{joint,dictalm}.json (written by eval-prefix-models.py)
and emits {word: {joint, dictalm, seg, stem}} keyed by lexiconKey — consumed by
/api/prefixes (model votes) and, later, PrefixContext.modelSeg.
"""
import json
from pathlib import Path

CACHE = Path('.cache')
OUT = Path('server/assets/segmentation.json')


def label(v, joint=False):
    if not isinstance(v, dict):
        return v
    if joint:
        if 'seg' not in v:
            return None
        return 'prefix' if v.get('prefixes') or len(v.get('seg') or []) > 1 else 'non-prefix'
    return v.get('label')


def load(name):
    p = CACHE / f'prefix-eval-{name}.json'
    return json.loads(p.read_text()) if p.exists() else {}


joint, dlm = load('joint'), load('dictalm')
out = {}
for w in sorted(set(joint) | set(dlm)):
    j, d = joint.get(w), dlm.get(w)
    ent = {}
    if label(j, joint=True):
        ent['joint'] = label(j, joint=True)
    if isinstance(j, dict) and j.get('seg'):
        ent['jointSeg'] = j['seg']
    if label(d):
        ent['dictalm'] = label(d)
    if isinstance(d, dict):
        if d.get('seg'):
            ent['seg'] = d['seg']
        if d.get('stem'):
            ent['stem'] = d['stem']
        if d.get('lex'):
            ent['lemma'] = d['lex']
    if ent:
        out[w] = ent

OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0) + '\n')
print(f'{len(out)} forms → {OUT}')
