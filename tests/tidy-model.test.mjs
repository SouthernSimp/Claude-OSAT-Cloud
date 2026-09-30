import assert from 'node:assert/strict'
import test from 'node:test'
import {
  archiveFolder, BATCH, cleanFolder, describeDone, describeGroup, destOfKey, groupPlan, keyOfDest, kindOf,
  menuFolders, oldFiles, readTidyAnswer, ruleDest, tidyMessages, tidySchema,
} from '../shared/tidy-model.mjs'

const file = (name, extra = {}) => ({ name, kind: kindOf(name), size: 1000, modifiedAt: '2026-09-01T00:00:00Z', ...extra })

test('kinds: screenshots, pictures, papers, installers, apps', () => {
  assert.equal(kindOf('Screenshot 2026-09-01 at 9.41.02 AM.png'), 'screenshot')
  assert.equal(kindOf('Screen Recording 2026-09-01.mov'), 'screenshot')
  assert.equal(kindOf('holiday.HEIC'), 'picture')
  assert.equal(kindOf('invoice.pdf'), 'pdf')
  assert.equal(kindOf('notes.docx'), 'document')
  assert.equal(kindOf('Setup.dmg'), 'installer')
  assert.equal(kindOf('Safari.app', { isPackage: true }), 'app')
  assert.equal(kindOf('Mystery.pages', { isPackage: true }), 'document')
  assert.equal(kindOf('Mystery.thing', { isPackage: true }), 'app')
  assert.equal(kindOf('run.sh'), 'app')
  assert.equal(kindOf('mystery'), 'other')
})

test('rules: installers to the Bin, apps and unknowns stay', () => {
  assert.deepEqual(ruleDest('installer'), { to: 'bin' })
  assert.deepEqual(ruleDest('screenshot'), { to: 'folder', folder: 'Screenshots' })
  assert.deepEqual(ruleDest('app'), { to: 'stay' })
  assert.deepEqual(ruleDest('other'), { to: 'stay' })
})

test('folder names: plain, inside Documents, at most three levels', () => {
  assert.equal(cleanFolder(' Money '), 'Money')
  assert.equal(cleanFolder('Archive/2026-09'), 'Archive/2026-09')
  for (const bad of ['', '..', '../x', '.hidden', 'a/b/c/d', 'a:b', 'a//b', 'a\\b']) assert.equal(cleanFolder(bad), null, bad)
  assert.deepEqual(destOfKey('folder:Money'), { to: 'folder', folder: 'Money' })
  assert.deepEqual(destOfKey('folder:../x'), { to: 'stay' })
  assert.equal(keyOfDest(destOfKey('bin')), 'bin')
})

test('the menu: Documents folders first, usual ones after, no repeats, never Bin or Stay', () => {
  const menu = menuFolders(['money', 'Taxes', 'Bin', '.x'])
  assert.deepEqual(menu.slice(0, 2), ['money', 'Taxes'])
  assert.equal(menu.filter((name) => name.toLowerCase() === 'money').length, 1)
  assert.ok(menu.includes('Projects') && menu.includes('Screenshots'))
  assert.ok(!menu.includes('Bin') && !menu.includes('.x'))
})

test('the AI schema only allows the menu, Bin and Stay', () => {
  const schema = tidySchema(['Money'])
  assert.deepEqual(schema.properties.files.items.properties.to.enum, ['Money', 'Bin', 'Stay'])
  assert.equal(schema.properties.files.maxItems, BATCH)
})

test('the question lists each file by number, with what is inside', () => {
  const [system, user] = tidyMessages({ files: [file('a.pdf', { peek: 'Invoice   #12\nTotal $40' }), file('b.png')], menu: ['Money'] })
  assert.match(system.content, /Money, Bin, Stay/)
  assert.match(user.content, /^1\. a\.pdf \(PDF, 1 KB · 2026-09-01\)\n {3}starts: Invoice #12 Total \$40\n2\. b\.png/)
})

test('the AI answer is cleaned: unknown places, missing numbers and a stray Bin fall back to the rules', () => {
  const files = [file('invoice.pdf'), file('Setup.dmg'), file('photo.jpg'), file('Safari.app', { kind: 'app' }), file('scan.pdf'), file('x.zip')]
  const menu = menuFolders()
  const answer = { files: [
    { n: 1, to: 'money' }, // case forgiven
    { n: 2, to: 'Bin' },
    { n: 3, to: 'Bin' }, // a picture never goes to the Bin on the AI's say-so
    { n: 4, to: 'Projects' }, // an app never moves
    { n: 5, to: 'Made-up place' },
    { n: 99, to: 'Money' }, // no such file
  ] }
  assert.deepEqual(readTidyAnswer(answer, files, menu), [
    { to: 'folder', folder: 'Money' },
    { to: 'bin' },
    { to: 'folder', folder: 'Pictures' },
    { to: 'stay' },
    { to: 'folder', folder: 'Papers' },
    { to: 'folder', folder: 'Archive' }, // no answer at all: the rule
  ])
  assert.deepEqual(readTidyAnswer('nonsense', [file('a.png')], menu), [{ to: 'folder', folder: 'Pictures' }])
  assert.deepEqual(readTidyAnswer({ files: [{ n: 1, to: 'Stay' }] }, [file('a.png')], menu), [{ to: 'stay' }])
})

test('the plan groups by place, biggest first, the Bin last, and says it in words', () => {
  const files = [...Array.from({ length: 3 }, (_, i) => file(`Screenshot ${i}.png`)), file('a.pdf'), file('b.pdf'), file('Setup.dmg'), file('Safari.app', { kind: 'app' })]
  const { groups, left } = groupPlan(files, files.map((item) => ruleDest(item.kind)))
  assert.equal(left, 1)
  assert.deepEqual(groups.map(describeGroup), ['3 screenshots → Documents/Screenshots', '2 PDFs → Documents/Papers', '1 installer → the Bin'])
  assert.equal(groups[0].names.length, 3)
  const mixed = groupPlan([file('a.pdf'), file('b.docx')], [{ to: 'folder', folder: 'Money' }, { to: 'folder', folder: 'Money' }]).groups
  assert.equal(describeGroup(mixed[0]), '2 files → Documents/Money')
})

test('the words after a tidy', () => {
  assert.equal(describeDone({ moved: 1 }), 'Tidied 1 thing')
  assert.equal(describeDone({ moved: 12, binned: 3 }), 'Tidied 15 things, 3 into the Bin')
  assert.equal(describeDone({ binned: 2 }), 'Tidied 2 things into the Bin')
  assert.equal(describeDone({}), 'Nothing needed moving.')
})

test('keeps itself tidy: a month old goes to Archive/year-month; apps stay', () => {
  const now = new Date(2026, 8, 30, 12)
  assert.equal(archiveFolder(now), 'Archive/2026-09')
  const list = [
    { name: 'old.pdf', kind: 'pdf', modifiedAt: new Date(2026, 7, 1).toISOString() },
    { name: 'new.pdf', kind: 'pdf', modifiedAt: new Date(2026, 8, 20).toISOString() },
    { name: 'Old.app', kind: 'app', modifiedAt: new Date(2026, 1, 1).toISOString() },
  ]
  assert.deepEqual(oldFiles(list, now), ['old.pdf'])
})
