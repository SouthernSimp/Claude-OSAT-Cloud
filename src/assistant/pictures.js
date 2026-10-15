/* Pictures in Ask (Phase 37b): pasted, dropped or chosen, each made small enough to read quickly (the longest side
   at most MAX_SIDE, which is more than the models look at) and kept as base64 for the question it goes with. They
   are never saved in the chat (it remembers their names, like files); only the AI on this Mac reads them. */

export const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const MAX_PICTURES = 4
export const MAX_SIDE = 2048

export const isPicture = (file) => Boolean(file) && PICTURE_TYPES.includes(file.type)

const base64Of = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
  reader.onerror = () => reject(new Error('That picture couldn’t be read.'))
  reader.readAsDataURL(blob)
})

/* { name, type, data, url }: `url` is for the chip's thumbnail. A picture larger than MAX_SIDE is drawn smaller;
   a screenshot (PNG) stays a PNG so its words stay sharp, a photo becomes a JPEG. */
export async function readPicture(file, { maxSide = MAX_SIDE } = {}) {
  if (!isPicture(file)) throw new Error('Ask reads PNG, JPEG, WebP and GIF pictures.')
  let blob = file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    if (scale < 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9)) || file
    }
    bitmap.close?.()
  } catch {
    // Drawn as it is when it can't be measured here; the AI still gets it.
  }
  if (blob.size > 10 * 1024 * 1024) throw new Error('That picture is over 10 MB, even made smaller. Try a smaller one.')
  return { name: file.name || 'Pasted picture', type: blob.type || file.type, data: await base64Of(blob), url: URL.createObjectURL(blob) }
}

/* The question's pictures go on the last question in what is sent; only type and data travel. */
export function withPictures(messages, pictures) {
  if (!pictures.length) return messages
  const at = messages.map((message) => message.role).lastIndexOf('user')
  if (at < 0) return messages
  const images = pictures.map(({ type, data }) => ({ type, data }))
  return messages.map((message, index) => (index === at ? { ...message, images } : message))
}

/* Why a picture can't go with this model, in plain words, or '' when it can. */
export function pictureProblem(model) {
  if (!model) return 'Choose a model first.'
  if (model.runtime !== 'osat') return 'Pictures go to the AI on this Mac, so they never leave it. Choose it in the model menu.'
  if (!model.sees) return `${model.label || 'This model'} can read pictures once its picture part is here. Settings → AI shows it downloading.`
  return ''
}
