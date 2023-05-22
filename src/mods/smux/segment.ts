import { Opaque, Writable } from "@hazae41/binary"
import { Cursor, CursorReadLengthOverflowError, CursorReadUnknownError, CursorWriteUnknownError } from "@hazae41/cursor"
import { Ok, Result } from "@hazae41/result"

export class SmuxUpdate {

  constructor(
    readonly consumed: number,
    readonly window: number
  ) { }

  trySize(): Result<number, never> {
    return new Ok(4 + 4)
  }

  tryWrite(cursor: Cursor): Result<void, CursorWriteUnknownError> {
    return Result.unthrowSync(t => {
      cursor.tryWriteUint32(this.consumed, true).throw(t)
      cursor.tryWriteUint32(this.window, true).throw(t)

      return Ok.void()
    })
  }

  static tryRead(cursor: Cursor): Result<SmuxUpdate, CursorReadUnknownError> {
    return Result.unthrowSync(t => {
      const consumed = cursor.tryReadUint32(true).throw(t)
      const window = cursor.tryReadUint32(true).throw(t)

      return new Ok(new SmuxUpdate(consumed, window))
    })
  }

}

export class SmuxSegment<Fragment extends Writable> {
  readonly #class = SmuxSegment

  static readonly versions = {
    one: 1,
    two: 2
  } as const

  static readonly commands = {
    syn: 0,
    fin: 1,
    psh: 2,
    nop: 3,
    upd: 4
  } as const

  private constructor(
    readonly version: number,
    readonly command: number,
    readonly stream: number,
    readonly fragment: Fragment,
    readonly fragmentSize: number
  ) { }

  static tryNew<Fragment extends Writable>(params: {
    version: number,
    command: number,
    stream: number,
    fragment: Fragment
  }): Result<SmuxSegment<Fragment>, Writable.SizeError<Fragment>> {
    const { version, command, stream, fragment } = params

    const fragmentSize = fragment.trySize()

    if (fragmentSize.isErr())
      return fragmentSize

    return new Ok(new SmuxSegment(version, command, stream, fragment, fragmentSize.get()))
  }

  trySize(): Result<number, never> {
    return new Ok(0
      + 1
      + 1
      + 2
      + 4
      + this.fragmentSize)
  }

  tryWrite(cursor: Cursor): Result<void, CursorWriteUnknownError | Writable.WriteError<Fragment>> {
    return Result.unthrowSync(t => {
      cursor.tryWriteUint8(this.version).throw(t)
      cursor.tryWriteUint8(this.command).throw(t)
      cursor.tryWriteUint16(this.fragmentSize, true).throw(t)
      cursor.tryWriteUint32(this.stream, true).throw(t)

      this.fragment.tryWrite(cursor).throw(t)

      return Ok.void()
    })
  }

  static tryRead(cursor: Cursor): Result<SmuxSegment<Opaque>, CursorReadUnknownError | CursorReadLengthOverflowError> {
    return Result.unthrowSync(t => {
      const version = cursor.tryReadUint8().throw(t)
      const command = cursor.tryReadUint8().throw(t)
      const length = cursor.tryReadUint16(true).throw(t)
      const stream = cursor.tryReadUint32(true).throw(t)
      const bytes = cursor.tryRead(length).throw(t)

      const fragment = new Opaque(bytes)

      return SmuxSegment.tryNew({ version, command, stream, fragment })
    })
  }
}