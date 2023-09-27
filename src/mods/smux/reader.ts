import { BinaryError, BinaryReadError, Empty, Opaque, Readable } from "@hazae41/binary";
import { SuperTransformStream } from "@hazae41/cascade";
import { Cursor } from "@hazae41/cursor";
import { CloseEvents, ErrorEvents, SuperEventTarget } from "@hazae41/plume";
import { Err, Ok, Result } from "@hazae41/result";
import { SmuxSegment, SmuxUpdate } from "./segment.js";
import { SecretSmuxDuplex } from "./stream.js";

export type SmuxReadError =
  | UnknownSmuxCommandError
  | InvalidSmuxVersionError
  | InvalidSmuxStreamError

export class UnknownSmuxCommandError extends Error {
  readonly #class = UnknownSmuxCommandError
  readonly name = this.#class.name

  constructor() {
    super(`Unknown SMUX command`)
  }

}

export class InvalidSmuxVersionError extends Error {
  readonly #class = InvalidSmuxVersionError
  readonly name = this.#class.name

  constructor(
    readonly version: number
  ) {
    super(`Invalid SMUX version ${version}`)
  }
}

export class InvalidSmuxStreamError extends Error {
  readonly #class = InvalidSmuxStreamError
  readonly name = this.#class.name

  constructor(
    readonly stream: number
  ) {
    super(`Invalid SMUX stream ${stream}`)
  }
}


export class SecretSmuxReader {

  readonly events = new SuperEventTarget<CloseEvents & ErrorEvents>()

  readonly stream: SuperTransformStream<Opaque, Opaque>

  constructor(
    readonly parent: SecretSmuxDuplex
  ) {
    this.stream = new SuperTransformStream({
      transform: this.#onRead.bind(this)
    })
  }

  async #onRead(chunk: Opaque): Promise<Result<void, SmuxReadError | BinaryError>> {
    // Console.debug("<-", chunk)

    if (this.parent.buffer.offset)
      return await this.#onReadBuffered(chunk.bytes)
    else
      return await this.#onReadDirect(chunk.bytes)
  }

  async #onReadBuffered(chunk: Uint8Array): Promise<Result<void, SmuxReadError | BinaryError>> {
    return await Result.unthrow(async t => {
      this.parent.buffer.tryWrite(chunk).throw(t)
      const full = new Uint8Array(this.parent.buffer.before)

      this.parent.buffer.offset = 0
      return await this.#onReadDirect(full)
    })
  }

  async #onReadDirect(chunk: Uint8Array): Promise<Result<void, SmuxReadError | BinaryError>> {
    return await Result.unthrow(async t => {
      const cursor = new Cursor(chunk)

      while (cursor.remaining) {
        const segment = Readable.tryReadOrRollback(SmuxSegment, cursor).ignore()

        if (segment.isErr()) {
          this.parent.buffer.tryWrite(cursor.after).throw(t)
          break
        }

        await this.#onSegment(segment.get()).then(r => r.throw(t))
      }

      return Ok.void()
    })
  }

  async #onSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, SmuxReadError | BinaryReadError>> {
    if (segment.version !== 2)
      return new Err(new InvalidSmuxVersionError(segment.version))

    // Console.log("<-", segment)

    if (segment.command === SmuxSegment.commands.psh)
      return await this.#onPshSegment(segment)
    if (segment.command === SmuxSegment.commands.nop)
      return await this.#onNopSegment(segment)
    if (segment.command === SmuxSegment.commands.upd)
      return await this.#onUpdSegment(segment)
    if (segment.command === SmuxSegment.commands.fin)
      return await this.#onFinSegment(segment)

    return new Err(new UnknownSmuxCommandError())
  }

  async #onPshSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, SmuxReadError>> {
    if (segment.stream !== this.parent.streamID)
      return new Err(new InvalidSmuxStreamError(segment.stream))

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

  async #onUpdSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, SmuxReadError | BinaryReadError>> {
    return await Result.unthrow(async t => {
      if (segment.stream !== this.parent.streamID)
        return new Err(new InvalidSmuxStreamError(segment.stream))

      const update = segment.fragment.tryReadInto(SmuxUpdate).throw(t)

      this.parent.peerConsumed = update.consumed
      this.parent.peerWindow = update.window

      return Ok.void()
    })
  }

  async #onFinSegment(segment: SmuxSegment<Opaque>): Promise<Result<void, SmuxReadError>> {
    if (segment.stream !== this.parent.streamID)
      return new Err(new InvalidSmuxStreamError(segment.stream))

    this.stream.controller.terminate()

    return Ok.void()
  }

}