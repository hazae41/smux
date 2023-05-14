import { BinaryReadUnderflowError, Empty, Opaque, Readable } from "@hazae41/binary";
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

  async #onRead(chunk: Opaque): Promise<Result<void, InvalidVersionError | InvalidStreamError | CursorReadUnknownError | CursorWriteLengthOverflowError | BinaryReadUnderflowError>> {
    // console.debug("<-", chunk)

    if (this.parent.buffer.offset)
      return await this.#onReadBuffered(chunk.bytes)
    else
      return await this.#onReadDirect(chunk.bytes)
  }

  async #onReadBuffered(chunk: Uint8Array): Promise<Result<void, InvalidVersionError | InvalidStreamError | CursorReadUnknownError | CursorWriteLengthOverflowError | BinaryReadUnderflowError>> {
    const write = this.parent.buffer.tryWrite(chunk)

    if (write.isErr())
      return write

    const full = new Uint8Array(this.parent.buffer.before)

    this.parent.buffer.offset = 0
    return await this.#onReadDirect(full)
  }

  async #onReadDirect(chunk: Uint8Array): Promise<Result<void, InvalidVersionError | InvalidStreamError | CursorReadUnknownError | CursorWriteLengthOverflowError | BinaryReadUnderflowError>> {
    const cursor = new Cursor(chunk)

    while (cursor.remaining) {
      const segment = Readable.tryReadOrRollback(SmuxSegment, cursor)

      if (segment.isErr()) {
        const write = this.parent.buffer.tryWrite(cursor.after)

        if (write.isErr())
          return write

        break
      }

      const result = await this.#onSegment(segment.inner)

      if (result.isErr())
        return result

      continue
    }

    return Ok.void()
  }

  async #onSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, InvalidVersionError | InvalidStreamError | CursorReadUnknownError | BinaryReadUnderflowError>> {
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

      const segment = SmuxSegment.tryNew({ version, command, stream, fragment }).inner

      this.parent.writer.stream.enqueue(segment)
      this.parent.selfIncrement = 0
    }

    return Ok.void()
  }

  async #onNopSegment(ping: SmuxSegment<Opaque>): Promise<Result<void, never>> {
    const version = 2
    const command = SmuxSegment.commands.nop
    const stream = ping.stream
    const fragment = new Empty()

    const pong = SmuxSegment.tryNew({ version, command, stream, fragment }).inner

    this.parent.writer.stream.enqueue(pong)

    return Ok.void()
  }

  async #onUpdSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, InvalidStreamError | CursorReadUnknownError | BinaryReadUnderflowError>> {
    if (segment.stream !== this.parent.streamID)
      return new Err(new InvalidStreamError(segment.stream))

    const update = segment.fragment.tryInto(SmuxUpdate)

    if (update.isErr())
      return update

    this.parent.peerConsumed = update.inner.consumed
    this.parent.peerWindow = update.inner.window

    return Ok.void()
  }

  async #onFinSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, InvalidStreamError>> {
    if (segment.stream !== this.parent.streamID)
      return new Err(new InvalidStreamError(segment.stream))

    this.stream.terminate()

    return Ok.void()
  }

}