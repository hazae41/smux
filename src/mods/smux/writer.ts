import { Empty, Writable } from "@hazae41/binary";
import { SuperTransformStream } from "@hazae41/cascade";
import { CloseEvents, ErrorEvents, SuperEventTarget } from "@hazae41/plume";
import { SmuxSegment, SmuxUpdate } from "./segment.js";
import { SecretSmuxDuplex } from "./stream.js";

export type SmuxWriteError =
  | PeerWindowOverflow

export class PeerWindowOverflow extends Error {
  readonly #class = PeerWindowOverflow
  readonly name = this.#class.name

  constructor() {
    super(`Peer window reached`)
  }
}

export class SecretSmuxWriter {

  readonly events = new SuperEventTarget<CloseEvents & ErrorEvents>()

  readonly stream: SuperTransformStream<Writable, Writable>

  constructor(
    readonly parent: SecretSmuxDuplex
  ) {
    this.stream = new SuperTransformStream({
      start: this.#onStart.bind(this),
      transform: this.#onTransform.bind(this)
    })
  }

  async #onStart() {
    await this.#sendSynOrThrow()
    await this.#sendUpdOrThrow()
  }

  async #sendSynOrThrow() {
    const version = 2
    const command = SmuxSegment.commands.syn
    const stream = this.parent.streamID
    const fragment = new Empty()

    const segment = SmuxSegment.empty({ version, command, stream, fragment })

    this.stream.enqueue(segment)
  }

  async #sendUpdOrThrow() {
    const version = 2
    const command = SmuxSegment.commands.upd
    const stream = this.parent.streamID
    const fragment = new SmuxUpdate(0, this.parent.selfWindow)

    const segment = SmuxSegment.newOrThrow({ version, command, stream, fragment })

    this.stream.enqueue(segment)
  }

  async #onTransform(fragment: Writable) {
    const inflight = this.parent.selfWrite - this.parent.peerConsumed

    if (inflight >= this.parent.peerWindow)
      throw new PeerWindowOverflow()

    const version = 2
    const command = SmuxSegment.commands.psh
    const stream = this.parent.streamID

    const segment = SmuxSegment.newOrThrow({ version, command, stream, fragment })

    this.stream.enqueue(segment)

    this.parent.selfWrite += segment.fragmentSize
  }

}