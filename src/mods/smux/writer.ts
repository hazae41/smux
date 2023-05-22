import { Empty, Writable } from "@hazae41/binary";
import { SuperTransformStream } from "@hazae41/cascade";
import { StreamEvents, SuperEventTarget } from "@hazae41/plume";
import { Err, Ok, Result } from "@hazae41/result";
import { SmuxSegment, SmuxUpdate } from "./segment.js";
import { SecretSmuxDuplex } from "./stream.js";

export class PeerWindowOverflow extends Error {
  readonly #class = PeerWindowOverflow

  constructor() {
    super(`Peer window reached`)
  }
}

export class SecretSmuxWriter {

  readonly events = new SuperEventTarget<StreamEvents>()

  readonly stream: SuperTransformStream<Writable, Writable>

  constructor(
    readonly parent: SecretSmuxDuplex
  ) {
    this.stream = new SuperTransformStream({
      start: this.#onStart.bind(this),
      transform: this.#onWrite.bind(this)
    })
  }

  async #onStart(): Promise<Result<void, never>> {
    await this.#sendSYN()
    await this.#sendUPD()

    return Ok.void()
  }

  async #sendSYN() {
    const version = 2
    const command = SmuxSegment.commands.syn
    const stream = this.parent.streamID
    const fragment = new Empty()

    const segment = SmuxSegment.tryNew({ version, command, stream, fragment })

    this.stream.enqueue(segment.get())
  }

  async #sendUPD() {
    const version = 2
    const command = SmuxSegment.commands.upd
    const stream = this.parent.streamID
    const fragment = new SmuxUpdate(0, this.parent.selfWindow)

    const segment = SmuxSegment.tryNew({ version, command, stream, fragment })

    this.stream.enqueue(segment.get())
  }

  async #onWrite<T extends Writable>(fragment: T): Promise<Result<void, PeerWindowOverflow | Writable.SizeError<T>>> {
    const inflight = this.parent.selfWrite - this.parent.peerConsumed

    if (inflight >= this.parent.peerWindow)
      return new Err(new PeerWindowOverflow())

    const version = 2
    const command = SmuxSegment.commands.psh
    const stream = this.parent.streamID

    const segment = SmuxSegment.tryNew({ version, command, stream, fragment })

    if (segment.isErr())
      return segment

    this.stream.enqueue(segment.get())

    this.parent.selfWrite += segment.get().fragmentSize

    return Ok.void()
  }

}