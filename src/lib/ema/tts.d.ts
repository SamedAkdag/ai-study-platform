/** Types for the EMA Lightning ONNX browser engine (web/tts.js). */

export const RATE: number

export function wavBlob(chunks: Float32Array[]): Blob

export class EMA {
  backend: string
  precision?: string
  static load(
    backend?: 'webgpu' | 'wasm' | string,
    base?: string,
    onProgress?: (stage: string, fraction: number) => void,
    precision?: 'fp32' | 'fp16' | string,
  ): Promise<EMA>
  release(): Promise<void>
  pieces(text: string, speed: number): [string, number][]
  stream(
    text: string,
    opts?: {
      speed?: number
      seed?: number
      stats?: Record<string, unknown>
      onPiece?: (info: {
        text: string
        words: string[]
        /** Start of each word in seconds, relative to this piece */
        starts: number[]
        /** Piece duration in seconds */
        seconds: number
        /** Trailing pause after this piece (seconds) */
        pause?: number
      }) => void
    },
  ): AsyncGenerator<Float32Array, void, unknown>
}
