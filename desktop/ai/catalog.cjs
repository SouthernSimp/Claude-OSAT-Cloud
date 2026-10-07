/* The AI models OSAT can set up by itself. Each is one file, pinned to an exact revision
   and checked against its SHA-256 after download; all are Apache 2.0 and run on the engine
   OSAT ships (node-llama-cpp's llama.cpp: gemma4, qwen35, qwen35moe, mistral3).
   The three `starter` sizes (Google's Gemma 4: Light, Balanced, Deep) are what the welcome
   offers; the rest are there to browse and compare in Settings → AI. `speed` and `smarts`
   are 1–5, relative to each other, for that comparison; `best` says what each is good at. */

const GB = 1024 ** 3

const TIERS = [
  {
    id: 'light',
    label: 'Light',
    model: 'Gemma 4 E2B',
    blurb: 'Quick and small. Fine on any Mac.',
    starter: true, maker: 'Google', speed: 5, smarts: 2, best: 'Quick replies on any Mac',
    file: 'gemma-4-E2B_q4_0-it.gguf',
    url: 'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/675cff42a74c774d6cb76f76d8eacb49b48c9b93/gemma-4-E2B_q4_0-it.gguf',
    size: 3349516256,
    sha256: 'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634',
    minMemory: 8 * GB,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    model: 'Gemma 4 E4B',
    blurb: 'More thoughtful, still quick.',
    starter: true, maker: 'Google', speed: 4, smarts: 3, best: 'Everyday questions and writing',
    file: 'gemma-4-E4B_q4_0-it.gguf',
    url: 'https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/4b4a2c1d584be7264f87aac328a1bc739ce81b6c/gemma-4-E4B_q4_0-it.gguf',
    size: 5154941280,
    sha256: '676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee',
    minMemory: 16 * GB,
  },
  {
    id: 'deep',
    label: 'Deep',
    model: 'Gemma 4 26B',
    blurb: 'The most careful answers. Needs a roomy Mac.',
    starter: true, maker: 'Google', speed: 3, smarts: 5, best: 'Careful answers; fast for its size',
    file: 'gemma-4-26B_q4_0-it.gguf',
    url: 'https://huggingface.co/google/gemma-4-26B-A4B-it-qat-q4_0-gguf/resolve/d1c082be9cf3c8a514acf63b8761f4b41935842e/gemma-4-26B_q4_0-it.gguf',
    size: 14439363584,
    sha256: '3eca3b8f6d7baf218a7dd6bba5fb59a56ee25fe2d567b6f5f589b4f697eca51d',
    minMemory: 32 * GB,
  },
  {
    id: 'ministral-3b',
    label: 'Ministral 3 3B',
    model: 'Ministral 3 3B',
    blurb: 'The smallest. Quick notes and sorting.',
    maker: 'Mistral', speed: 5, smarts: 2, best: 'The smallest download; quick notes',
    file: 'Ministral-3-3B-Instruct-2512-Q4_K_M.gguf',
    url: 'https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF/resolve/eb599d408350ea2bb60452cb86be7c7b2fc28227/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf',
    size: 2147023008,
    sha256: '9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8',
    minMemory: 8 * GB,
  },
  {
    id: 'qwen35-4b',
    label: 'Qwen 3.5 4B',
    model: 'Qwen 3.5 4B',
    blurb: 'Small and sharp. Keeps to the format it is asked for.',
    maker: 'Qwen (Alibaba)', speed: 4, smarts: 3, best: 'Sorting and short answers on a small Mac',
    file: 'Qwen3.5-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf',
    size: 2740937888,
    sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
    minMemory: 8 * GB,
  },
  {
    id: 'ministral-8b',
    label: 'Ministral 3 8B',
    model: 'Ministral 3 8B',
    blurb: 'Clear, plain writing.',
    maker: 'Mistral', speed: 3, smarts: 4, best: 'Writing and rewriting',
    file: 'Ministral-3-8B-Instruct-2512-Q4_K_M.gguf',
    url: 'https://huggingface.co/mistralai/Ministral-3-8B-Instruct-2512-GGUF/resolve/0102285ad796bd99af90f58de616092e5630e970/Ministral-3-8B-Instruct-2512-Q4_K_M.gguf',
    size: 5198911904,
    sha256: '33e7a72cf5e6e2cfc2f2847075acc013d68bba023e35310cef86b5cf8fdca761',
    minMemory: 16 * GB,
  },
  {
    id: 'qwen35-9b',
    label: 'Qwen 3.5 9B',
    model: 'Qwen 3.5 9B',
    blurb: 'Smart for its size.',
    maker: 'Qwen (Alibaba)', speed: 3, smarts: 4, best: 'Sorting big piles; questions about your notes',
    file: 'Qwen3.5-9B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5/Qwen3.5-9B-Q4_K_M.gguf',
    size: 5680522464,
    sha256: '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
    minMemory: 16 * GB,
  },
  {
    id: 'gemma4-12b',
    label: 'Gemma 4 12B',
    model: 'Gemma 4 12B',
    blurb: 'Between Balanced and Deep.',
    maker: 'Google', speed: 3, smarts: 4, best: 'Thoughtful answers on a 24 GB Mac',
    file: 'gemma-4-12b-it-qat-q4_0.gguf',
    url: 'https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/resolve/29d097773436b69ff9feafd636ab4cf873786537/gemma-4-12b-it-qat-q4_0.gguf',
    size: 6975879296,
    sha256: '93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b',
    minMemory: 24 * GB,
  },
  {
    id: 'qwen36-35b',
    label: 'Qwen 3.6 35B',
    model: 'Qwen 3.6 35B',
    blurb: 'The deepest here. Quick for its size, but a big download.',
    maker: 'Qwen (Alibaba)', speed: 3, smarts: 5, best: 'The most capable answers, on a 36 GB+ Mac',
    file: 'Qwen3.6-35B-A3B-UD-IQ4_XS.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/a483e9e6cbd595906af30beda3187c2663a1118c/Qwen3.6-35B-A3B-UD-IQ4_XS.gguf',
    size: 17730509792,
    sha256: '649d7508507b84638732c4f52c24c8b15843c6dca2f3ff793ae07c14a67ebbb3',
    minMemory: 36 * GB,
  },
]

const fits = (tier, totalMemory) => totalMemory >= tier.minMemory * 0.97

/* The largest starter size this Mac's memory holds comfortably (the welcome's pick). */
function pickTier(totalMemory, tiers = TIERS) {
  const starters = tiers.filter((tier) => tier.starter)
  return [...starters].reverse().find((tier) => fits(tier, totalMemory)) || starters[0]
}

/* The best model for this Mac, of all of them: the smartest that fits its memory; between
   equals, the bigger (it fits, and bigger answers better), then the quicker, then the larger file. */
function recommendFor(totalMemory, tiers = TIERS) {
  const fitting = tiers.filter((tier) => fits(tier, totalMemory))
  if (!fitting.length) return pickTier(totalMemory, tiers)
  return [...fitting].sort((a, b) => b.smarts - a.smarts || b.minMemory - a.minMemory || b.speed - a.speed || b.size - a.size)[0]
}

const tierById = (id, tiers = TIERS) => tiers.find((tier) => tier.id === id) || null

module.exports = { TIERS, fits, pickTier, recommendFor, tierById }
