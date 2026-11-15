# Cosmo Signature Triage — багц (v3)

## 1. Хуулах
Энэ багцын `docs/` ба `data/` хавтсыг Cosmo repo-ийн үндсэн хавтсанд хуулна (нэгтгэнэ, юу ч устгахгүй).

- `docs/SIGNATURE_SPEC.md` — дизайн, томьёо, үр дүн, хязгаарлалт, эх сурвалж
- `docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md` — хоёр шинжилгээний баталгаа, demo-ийн дараалал
- `docs/PROMPT_SIGNATURE_INTEGRATE.md` — **эхлэх цэг** (Claude Code-д өгөх prompt)
- `docs/PROMPT_SIGNATURE_BUILD.md` — даалгавар T0–T14, тестийн тоонууд
- `docs/signature_reference/` — Python лавлах хэрэгжүүлэлт, fixture JSON, MANIFEST.sha256
- `data/OSD-575_LSDS-8_Alamar_NULISA_serum_TRANSFORMED.csv` — зургаа дахь өгөгдлийн файл (шинэ)

Өмнөх таван NASA CSV файл repo-д аль хэдийн байх ёстой. Байхгүй бол `data/` дотор хийнэ.

## 2. Claude Code-д бичих (Sonnet 5.5)

```
Read docs/PROMPT_SIGNATURE_INTEGRATE.md and execute it from Step 0 to the end.
It is the entry point; docs/PROMPT_SIGNATURE_BUILD.md holds the task definitions.
Do not ask questions. Record every decision in docs/SIGNATURE_BUILD_NOTES.md.
```

## 3. Шалгах
1. Step 0-ийн дараа `docs/SIGNATURE_INTEGRATION_MAP.md` гарна. REUSE/ADD жагсаалтыг нэг уншина.
2. Ажил `feat/signature-triage` салбар дээр явна. Done жагсаалт бүгд ногоон болмогц main руу нэгтгэнэ.
3. Demo: `/demo/signature`, Wi-Fi унтраасан үед 3 минутад багтах ёстой.
