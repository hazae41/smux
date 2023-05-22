import { CursorReadLengthUnderflowError, Empty, Opaque, Readable } from "@hazae41/binary";
import { SuperTransformStream } from "@hazae41/cascade";
import { Cursor, CursorReadUnknownError, CursorWriteLengthOverflowError } from "@hazae41/cursor";
import { StreamEvents, SuperEventTarget } from "@hazae41/plume";
import { Err, Ok, Result } from "@hazae41/result";
import { SmuxSegment, SmuxUpdate } from "./segment.js";
import { SecretSmuxDuplex } from "./stream.js";

export class InvalidVersionError extends Error {
  readonly #class = InvalidVersionError

  constructor(
    readonly version: number
  ) {
    super(`Invalid SMUX version ${version}`)
  }
}

export class InvalidStreamError extends Error {
  readonly #class = InvalidStreamError

  constructor(
    readonly stream: number
  ) {
    super(`Invalid SMUX stream ${stream}`)
  }
}


export class SecretSmuxReader {

  readonly events = new SuperEventTarget<StreamEvents>()

  readonly stream: SuperTransformStream<Opaque, Opaque>

  constructor(
    readonly parent: SecretSmuxDuplex
  ) {
    this.stream = new SuperTransformStream({
      transform: this.#onRead.bind(this)
    })
  }

  async #onRead(chunk: Opaque): Promise<Result<void, InvalidVersionError | InvalidStreamError | CursorReadUnknownError | CursorWriteLengthOverflowError | CursorReadLengthUnderflowError>> {
    // console.debug("<-", chunk)

    if (this.parent.buffer.offset)
      return await this.#onReadBuffered(chunk.bytes)
    else
      return await this.#onReadDirect(chunk.bytes)
  }

  async #onReadBuffered(chunk: Uint8Array): Promise<Result<void, InvalidVersionError | InvalidStreamError | CursorReadUnknownError | CursorWriteLengthOverflowError | CursorReadLengthUnderflowError>> {
    return await Result.unthrow(async t => {
      this.parent.buffer.tryWrite(chunk).throw(t)

      const full = new Uint8Array(this.parent.buffer.before)

      this.parent.buffer.offset = 0
      return await this.#onReadDirect(full)
    })
  }

  async #onReadDirect(chunk: Uint8Array): Promise<Result<void, InvalidVersionError | InvalidStreamError | CursorReadUnknownError | CursorWriteLengthOverflowError | CursorReadLengthUnderflowError>> {
    return await Result.unthrow(async t => {
      const cursor = new Cursor(chunk)

      while (cursor.remaining) {
        const segment = Readable.tryReadOrRollback(SmuxSegment, cursor)

        if (segment.isErr()) {
          this.parent.buffer.tryWrite(cursor.after).throw(t)

          break
        }

        await this.#onSegment(segment.get()).then(r => r.throw(t))

        continue
      }

      return Ok.void()
    })
  }

  async #onSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, InvalidVersionError | InvalidStreamError | CursorReadUnknownError | CursorReadLengthUnderflowError>> {
    if (segment.version !== 2)
      return new Err(new InvalidVersionError(segment.version))

    // console.log("<-", segment)

    if (segment.command === SmuxSegment.commands.psh)
      return await this.#onPshSegment(segment)
    if (segment.command === SmuxSegment.commands.nop)
      return await this.#onNopSegment(segment)
    if (segment.command === SmuxSegment.commands.upd)
      return await this.#onUpdSegment(segment)
    if (segment.command === SmuxSegment.commands.fin)
      return await this.#onFinSegment(segment)

    console.warn(segment)
    return Ok.void()
  }

  async #onPshSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, InvalidStreamError>> {
    if (segment.stream !== this.parent.streamID)
      return new Err(new InvalidStreamError(segment.stream))

    this.parent.selfRead += segment.fragment.bytes.length
    this.parent.selfIncrement += segment.fragment.bytes.length

    this.stream.enqueue(segment.fragment)

    if (this.parent.selfIncrement >= (this.parent.selfWindow / 2)) {
      const version = 2
      const command = SmuxSegment.commands.upd
      const stream = this.parent.streamID
      const fragment = new SmuxUpdate(this.parent.selfRead, this.parent.selfWindow)

      const segment = SmuxSegment.tryNew({ version, command, stream, fragment })

      this.parent.writer.stream.enqueue(segment.get())
      this.parent.selfIncrement = 0
    }

    return Ok.void()
  }

  async #onNopSegment(ping: SmuxSegment<Opaque>): Promise<Result<void, never>> {
    const version = 2
    const command = SmuxSegment.commands.nop
    const stream = ping.stream
    const fragment = new Empty()

    const pong = SmuxSegment.tryNew({ version, command, stream, fragment })

    this.parent.writer.stream.enqueue(pong.get())

    return Ok.void()
  }

  async #onUpdSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, InvalidStreamError | CursorReadUnknownError | CursorReadLengthUnderflowError>> {
    return await Result.unthrow(async t => {
      if (segment.stream !== this.parent.streamID)
        return new Err(new InvalidStreamError(segment.stream))

      const update = segment.fragment.tryInto(SmuxUpdate).throw(t)

      this.parent.peerConsumed = update.consumed
      this.parent.peerWindow = update.window

      return Ok.void()
    })
  }

  async #onFinSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, InvalidStreamError>> {
    if (segment.stream !== this.parent.streamID)
      return new Err(new InvalidStreamError(segment.stream))

    this.stream.terminate()

    return Ok.void()
  }

}