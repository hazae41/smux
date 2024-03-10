import { Empty, Opaque, Readable } from "@hazae41/binary";
import { Cursor } from "@hazae41/cursor";
import { None } from "@hazae41/option";
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

  constructor(
    readonly parent: SecretSmuxDuplex
  ) {
    this.parent.input.events.on("message", async chunk => {
      await this.#onMessage(chunk)
      return new None()
    })
  }

  async #onMessage(chunk: Opaque) {
    // Console.debug("<-", chunk)

    if (this.parent.buffer.offset)
      return await this.#onReadBuffered(chunk.bytes)
    else
      return await this.#onReadDirect(chunk.bytes)
  }

  async #onReadBuffered(chunk: Uint8Array) {
    this.parent.buffer.writeOrThrow(chunk)
    const full = new Uint8Array(this.parent.buffer.before)

    this.parent.buffer.offset = 0
    return await this.#onReadDirect(full)
  }

  async #onReadDirect(chunk: Uint8Array) {
    const cursor = new Cursor(chunk)

    while (cursor.remaining) {
      let segment: SmuxSegment<Opaque>

      try {
        segment = Readable.readOrRollbackAndThrow(SmuxSegment, cursor)
      } catch (e: unknown) {
        this.parent.buffer.writeOrThrow(cursor.after)
        break
      }

      await this.#onSegment(segment)
    }
  }

  async #onSegment(segment: SmuxSegment<Opaque>) {
    if (segment.version !== 2)
      throw new InvalidSmuxVersionError(segment.version)

    // Console.log("<-", segment)

    if (segment.command === SmuxSegment.commands.psh)
      return await this.#onPshSegment(segment)
    if (segment.command === SmuxSegment.commands.nop)
      return await this.#onNopSegment(segment)
    if (segment.command === SmuxSegment.commands.upd)
      return await this.#onUpdSegment(segment)
    if (segment.command === SmuxSegment.commands.fin)
      return await this.#onFinSegment(segment)

    throw new UnknownSmuxCommandError()
  }

  async #onPshSegment(segment: SmuxSegment<Opaque>) {
    if (segment.stream !== this.parent.streamID)
      throw new InvalidSmuxStreamError(segment.stream)

    this.parent.selfRead += segment.fragment.bytes.length
    this.parent.selfIncrement += segment.fragment.bytes.length

    await this.parent.input.enqueue(segment.fragment)

    if (this.parent.selfIncrement >= (this.parent.selfWindow / 2)) {
      const version = 2
      const command = SmuxSegment.commands.upd
      const stream = this.parent.streamID
      const fragment = new SmuxUpdate(this.parent.selfRead, this.parent.selfWindow)

      const segment = SmuxSegment.newOrThrow({ version, command, stream, fragment })

      await this.parent.output.enqueue(segment)

      this.parent.selfIncrement = 0
    }
  }

  async #onNopSegment(ping: SmuxSegment<Opaque>) {
    const version = 2
    const command = SmuxSegment.commands.nop
    const stream = ping.stream
    const fragment = new Empty()

    const pong = SmuxSegment.empty({ version, command, stream, fragment })

    await this.parent.output.enqueue(pong)
  }

  async #onUpdSegment(segment: SmuxSegment<Opaque>) {
    if (segment.stream !== this.parent.streamID)
      throw new InvalidSmuxStreamError(segment.stream)

    const update = segment.fragment.readIntoOrThrow(SmuxUpdate)

    this.parent.peerConsumed = update.consumed
    this.parent.peerWindow = update.window
  }

  async #onFinSegment(segment: SmuxSegment<Opaque>) {
    if (segment.stream !== this.parent.streamID)
      throw new InvalidSmuxStreamError(segment.stream)

    await this.parent.output.close()
  }

}