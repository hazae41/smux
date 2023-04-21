# SMUX

Zero-copy SMUX protocol for the web

```bash
npm i @hazae41/smux
```

[**Node Package 📦**](https://www.npmjs.com/package/@hazae41/smux)

## Features

### Current features
- 100% TypeScript and ESM
- Zero-copy reading and writing
- Works in the browser

### [Upcoming features](https://github.com/sponsors/hazae41)
- Multiplexing

## Usage

```typescript
import { SmuxDuplex } from "@hazae41/smux"

const smux = new SmuxDuplex(kcp)
```