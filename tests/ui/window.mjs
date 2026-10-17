/* OSAT's window in the browser preview (Phase 73): a place is opened from the sidebar, the way a person does it.
   A tile (Today, Just in, Calendar, To do), a board, a row in a group (the power tools unfold first), or Settings. */

const side = (page) => page.locator('nav.side')

export function sideButton(page, label) {
  return side(page).locator(`.side-tile:has(.side-tile-label:text-is("${label}")), .side-row:has(> span:text-is("${label}"))`).first()
}

export async function openRoom(page, label) {
  const button = sideButton(page, label)
  if (!await button.count()) await side(page).getByRole('button', { name: 'Power tools' }).click()
  await button.click()
}

/* The room open now (its box in the window). */
export const roomOf = (page, view) => page.locator(`.app-room[data-view="${view}"]`)
