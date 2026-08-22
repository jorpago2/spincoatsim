import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

function record(type: number, data: Uint8Array = new Uint8Array()) {
  const result = new Uint8Array(4 + data.length)
  new DataView(result.buffer).setUint16(0, result.length, false)
  result[2] = type
  result.set(data, 4)
  return result
}

function int16(value: number) {
  const result = new Uint8Array(2)
  new DataView(result.buffer).setInt16(0, value, false)
  return result
}

function polygonGds() {
  const name = new TextEncoder().encode('TOP\0')
  const coordinates = new Int32Array([
    0, 0, 100_000, 0, 100_000, 100_000, 0, 100_000, 0, 0,
  ])
  const xy = new Uint8Array(coordinates.length * 4)
  const view = new DataView(xy.buffer)
  coordinates.forEach((value, index) => view.setInt32(index * 4, value, false))
  const records = [
    record(0x05),
    record(0x06, name),
    record(0x08),
    record(0x0d, int16(1)),
    record(0x0e, int16(0)),
    record(0x10, xy),
    record(0x11),
    record(0x07),
  ]
  const size = records.reduce((total, current) => total + current.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const current of records) {
    result.set(current, offset)
    offset += current.length
  }
  return result
}

function twoTopCellGds() {
  const structure = (name: string, xOffset: number) => {
    const encodedName = new TextEncoder().encode(`${name}\0`)
    const coordinates = new Int32Array([
      xOffset, 0, xOffset + 50_000, 0, xOffset + 50_000, 50_000,
      xOffset, 50_000, xOffset, 0,
    ])
    const xy = new Uint8Array(coordinates.length * 4)
    const view = new DataView(xy.buffer)
    coordinates.forEach((value, index) => view.setInt32(index * 4, value, false))
    return [
      record(0x05), record(0x06, encodedName), record(0x08),
      record(0x0d, int16(1)), record(0x0e, int16(0)), record(0x10, xy),
      record(0x11), record(0x07),
    ]
  }
  const records = [...structure('CELL_A', 0), ...structure('CELL_B', 75_000)]
  const result = new Uint8Array(records.reduce((total, current) => total + current.length, 0))
  let offset = 0
  for (const current of records) {
    result.set(current, offset)
    offset += current.length
  }
  return result
}

function slowButValidGds() {
  const trailer = polygonGds()
  const prefixSize = 20 * 1024 * 1024
  const result = new Uint8Array(prefixSize + trailer.length)
  for (let offset = 0; offset < prefixSize; offset += 4) {
    result[offset + 1] = 4
  }
  result.set(trailer, prefixSize)
  return result
}

test('imports and flattens a local GDS in the worker', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('')
  await page.locator('#spin-nav-input').click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'worker-fixture.gds',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(polygonGds()),
  })
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByText('worker-fixture.gds', { exact: true }).last()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel import' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('demo result is responsive, current and explicit about calibration', async ({
  page,
}) => {
  await page.goto('')
  await page.getByRole('button', { name: /Load example/ }).first().click()
  await expect(page.getByRole('region', { name: 'Coating results' }).getByText('Inputs and profile up to date', { exact: true })).toBeVisible()
  await expect(page.getByText('Calibration law', { exact: true })).toBeVisible()
  await expect(page.getByText(/generic single-reference-point model/i)).toBeVisible()
  const fit = await page.evaluate(() => ({
    overflowX:
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
    canvas: document.querySelector('canvas')?.getBoundingClientRect().width ?? 0,
    viewport: window.innerWidth,
    stageOverflow: getComputedStyle(document.querySelector('.scientific-workbench__stage')!).overflowY,
    previewOverflow: getComputedStyle(document.querySelector('.spin-preview')!).overflowY,
  }))
  expect(fit.overflowX).toBe(false)
  expect(fit.canvas).toBeGreaterThan(0)
  expect(fit.canvas).toBeLessThanOrEqual(fit.viewport)
  expect(fit.stageOverflow).toBe('auto')
  expect(fit.previewOverflow).toBe('visible')
})

test('a section outside imported geometry blocks the profile and export', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: /Load example/ }).first().click()
  await page.locator('#spin-nav-input').click()
  const sectionY = page.getByLabel('Section Y (µm)')
  await sectionY.fill('1000')
  await sectionY.press('Enter')

  const inputPanel = page.getByRole('complementary', { name: 'GDS section' })
  await expect(inputPanel.getByText('No valid section', { exact: true })).toBeVisible()
  await expect(inputPanel.locator('p.spin-note')).toContainText('outside the imported polygon geometry')
  await inputPanel.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('heading', { name: 'No coating profile for this section' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export JSON' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export PNG' })).toHaveCount(0)
})

test('the canvas has a navigable numeric profile alternative', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: /Load example/ }).first().click()
  await page.getByText('Accessible profile data', { exact: true }).click()
  await expect(page.getByRole('table', { name: 'Accessible spin-coated profile data' })).toBeVisible()
  await expect(page.getByText(/Surface range/)).toBeVisible()
})

test('canvas pointer coordinates follow the plotted x-axis margins', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: /Load example/ }).first().click()
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return

  const margins = await canvas.evaluate((element) => {
    const width = element.clientWidth
    return width < 600 ? { left: 52, right: 14 } : { left: 76, right: 30 }
  })
  const readout = page.locator('#spin-readout span')
  await page.mouse.move(box.x + margins.left + 1, box.y + box.height / 2)
  await expect.poll(async () => Number((await readout.textContent())?.match(/-?\d+(?:\.\d+)?/)?.[0])).toBeLessThan(-49)
  await page.mouse.move(box.x + box.width - margins.right - 1, box.y + box.height / 2)
  await expect.poll(async () => Number((await readout.textContent())?.match(/-?\d+(?:\.\d+)?/)?.[0])).toBeGreaterThan(49)
})

test('active GDS work can be cancelled without publishing a late result', async ({
  page,
}) => {
  await page.goto('')
  await page.locator('#spin-nav-input').click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'cancel-fixture.gds',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(slowButValidGds()),
  })
  await page.getByRole('button', { name: 'Cancel import' }).click({ force: true })
  await expect(page.getByText(/GDS import cancelled/i)).toBeVisible()
  await expect(page.getByText(/Cell TOP/)).toHaveCount(0)
})

test('React owns panel visibility, keyboard focus and Carbon editor state', async ({
  page,
}) => {
  await page.goto('')
  const panelColumn = page.locator('.scientific-workbench__panel')
  await expect(panelColumn).toBeHidden()
  expect(await panelColumn.evaluate((element) => getComputedStyle(element).display)).toBe('none')

  const inputTool = page.locator('#spin-nav-input')
  const controlledId = await inputTool.getAttribute('aria-controls')
  expect(controlledId).toBeTruthy()
  await expect(page.locator(`#${controlledId}`)).toHaveCount(1)

  await inputTool.click()
  await page.getByLabel('Section Y (µm)').focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'GDS section' })).toBeHidden()
  await expect(inputTool).toBeFocused()

  await page.getByRole('button', { name: 'Process stack' }).click()
  await page.getByLabel('Operation').last().selectOption('etch')
  await expect(page.getByLabel('GDS layer').last()).toBeVisible()

  await page.getByRole('button', { name: 'Film model' }).click()
  const leveling = page.getByRole('slider', { name: /Leveling strength/i })
  await leveling.press('ArrowRight')
  await expect(leveling).toHaveAttribute('aria-valuenow', '66')

  await page.getByRole('button', { name: /Use dark theme/i }).click()
  await expect(page.getByRole('button', { name: /Use light theme/i })).toBeVisible()
})

test('result updates keep the active editor and page hierarchy stable', async ({
  page,
}) => {
  await page.goto('')
  await page.getByRole('button', { name: /Load example/ }).first().click()
  await page.getByRole('button', { name: 'Film model' }).click()
  await page.waitForTimeout(1_100)

  const filmPanel = page.getByRole('complementary', { name: 'Calibrated film' })
  const referenceProcess = page.getByRole('combobox', {
    name: /Reference process/,
  })
  await page.getByRole('button', { name: 'Open' }).click()
  await page
    .getByRole('option', { name: 'MICROPOSIT S1805 · 0.5 µm' })
    .click()

  await expect(filmPanel).toBeVisible()
  await expect(referenceProcess).toBeFocused()
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'SpinCoatSim spin-coating cross-section simulator',
    }),
  ).toHaveCount(1)
})

test('autosave recovery keeps custom calibration behind a selected reference', async ({
  page,
}) => {
  await page.goto('')
  await page.getByRole('button', { name: /Load example/ }).first().click()
  await page.getByRole('button', { name: 'Film model' }).click()
  await page.getByLabel('Film thickness').fill('245')
  await page.getByRole('button', { name: 'Open' }).click()
  await page
    .getByRole('option', { name: 'MICROPOSIT S1805 · 0.5 µm' })
    .click()
  await expect(page.getByLabel('Film thickness')).toHaveValue('500')
  await expect(page.locator('.scientific-autosave-status')).toContainText('Saved locally')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Restore session' })).toBeVisible()
  await page.getByRole('button', { name: 'Restore session' }).click()
  await page.getByRole('button', { name: 'Film model' }).click()
  await expect(page.getByLabel('Film thickness')).toHaveValue('500')
  await page.getByRole('button', { name: 'Restore custom calibration' }).click()
  await expect(page.getByLabel('Film thickness')).toHaveValue('245')
})

test('multiple GDS top cells are resolved in a React Carbon modal', async ({ page }) => {
  await page.goto('')
  await page.locator('#spin-nav-input').click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'multiple-top-cells.gds',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(twoTopCellGds()),
  })
  const modal = page.getByRole('dialog', { name: 'GDS import' })
  await expect(modal).toBeVisible()
  const report = await new AxeBuilder({ page }).analyze()
  expect(
    report.violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    ),
  ).toEqual([])

  await page.setViewportSize({ width: 320, height: 568 })
  const modalActions = modal.getByRole('button', {
    name: /Cancel import|Use selected cell/,
  })
  const actionMetrics = await modalActions.evaluateAll((buttons) =>
    buttons.map((button) => ({
      clientHeight: button.clientHeight,
      scrollHeight: button.scrollHeight,
      width: button.getBoundingClientRect().width,
    })),
  )
  expect(actionMetrics).toHaveLength(2)
  expect(actionMetrics.every(({ clientHeight, scrollHeight }) => scrollHeight <= clientHeight)).toBe(true)
  expect(actionMetrics.every(({ width }) => width >= 300)).toBe(true)

  await page.getByLabel('Top cell').selectOption('CELL_B')
  await page.getByRole('button', { name: 'Use selected cell' }).click()
  await expect(page.locator('canvas')).toBeVisible()
  await page.locator('#spin-nav-input').click()
  await expect(page.getByText(/Cell CELL_B/)).toBeVisible()
})

test('initial and result states have no serious accessibility violations', async ({
  page,
}) => {
  await page.goto('')
  let report = await new AxeBuilder({ page }).analyze()
  expect(
    report.violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    ),
  ).toEqual([])
  await page.getByRole('button', { name: /Load example/ }).first().click()
  report = await new AxeBuilder({ page }).analyze()
  expect(
    report.violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    ),
  ).toEqual([])
})
