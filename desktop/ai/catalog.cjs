/* The three sizes of AI OSAT can set up by itself. Each is one file, pinned to an
   exact revision and checked against its SHA-256 after download. All three are
   Google's Gemma 4 (Apache 2.0), quantized by Google for speed on a laptop. */

const GB = 1024 ** 3

const TIERS = [
  {
    id: 'light',
    label: 'Light',
    model: 'Gemma 4 E2B',
    blurb: 'Quick and small. Fine on any Mac.',
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
    file: 'gemma-4-26B_q4_0-it.gguf',
    url: 'https://huggingface.co/google/gemma-4-26B-A4B-it-qat-q4_0-gguf/resolve/d1c082be9cf3c8a514acf63b8761f4b41935842e/gemma-4-26B_q4_0-it.gguf',
    size: 14439363584,
    sha256: '3eca3b8f6d7baf218a7dd6bba5fb59a56ee25fe2d567b6f5f589b4f697eca51d',
    minMemory: 32 * GB,
  },
]

/* The largest size this Mac's memory holds comfortably. */
function pickTier(totalMemory, tiers = TIERS) {
  return [...tiers].reverse().find((tier) => totalMemory >= tier.minMemory * 0.97) || tiers[0]
}

const tierById = (id, tiers = TIERS) => tiers.find((tier) => tier.id === id) || null

module.exports = { TIERS, pickTier, tierById }
