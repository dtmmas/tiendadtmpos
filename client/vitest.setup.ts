import '@testing-library/jest-dom/vitest'

class MockFileReader {
  result: string | ArrayBuffer | null = null

  onload: null | (() => void) = null

  onerror: null | (() => void) = null

  readAsDataURL(file: Blob) {
    this.result = `data:${file.type || 'application/octet-stream'};base64,MOCK_DATA`
    if (this.onload) this.onload()
  }
}

Object.defineProperty(globalThis, 'FileReader', {
  writable: true,
  value: MockFileReader,
})
