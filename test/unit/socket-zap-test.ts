import * as zmq from "../../src"

import {assert} from "chai"
import {testProtos, uniqAddress} from "./helpers"

for (const proto of testProtos("tcp", "ipc")) {
  describe(`socket with ${proto} zap`, function() {
    let sockA: zmq.Pair
    let sockB: zmq.Pair
    let handler: ZapHandler

    beforeEach(function() {
      sockA = new zmq.Pair
      sockB = new zmq.Pair
    })

    afterEach(function() {
      handler.stop()
      sockA.close()
      sockB.close()
      global.gc()
    })

    describe("with plain mechanism", function() {
      it("should deliver message", async function() {
        handler = new ValidatingZapHandler({
          domain: "test",
          mechanism: "PLAIN",
          credentials: ["user", "pass"],
        })

        sockA.plainServer = true
        sockA.zapDomain = "test"

        sockB.plainUsername = "user"
        sockB.plainPassword = "pass"

        assert.equal(sockA.securityMechanism, "plain")
        assert.equal(sockB.securityMechanism, "plain")

        const address = uniqAddress(proto)
        await sockA.bind(address)
        await sockB.connect(address)

        const sent = "foo"
        await sockA.send(sent)
        const recv = await sockB.receive()
        assert.deepEqual([sent], recv.map((buf: Buffer) => buf.toString()))
      })

      it("should report authentication error", async function() {
        handler = new ValidatingZapHandler({
          domain: "test",
          mechanism: "PLAIN",
          credentials: ["user", "pass"],
        })

        sockA.plainServer = true
        sockA.zapDomain = "test"

        sockB.plainUsername = "user"
        sockB.plainPassword = "BAD PASS"

        const address = uniqAddress(proto)
        await sockA.bind(address)
        await sockB.connect(address)

        const [eventA, eventB] = await Promise.all([
          captureEvent(sockA, "handshake:error:auth"),
          captureEvent(sockB, "handshake:error:auth"),
        ])

        assert.equal(eventA.type, "handshake:error:auth")
        assert.equal(eventB.type, "handshake:error:auth")

        assert.equal(eventA.address, address)
        assert.equal(eventB.address, address)

        assert.instanceOf(eventA.error, Error)
        assert.instanceOf(eventB.error, Error)

        assert.equal(eventA.error.message, "Authentication failure")
        assert.equal(eventB.error.message, "Authentication failure")

        assert.equal(eventA.error.status, 400)
        assert.equal(eventB.error.status, 400)
      })

      it("should report protocol error", async function() {
        handler = new CustomZapHandler(
          ([path, delim, version, id, ...rest]) => {
            return [path, delim, "9.9", id, "200", "OK", null, null]
          },
        )

        sockA.plainServer = true
        sockA.zapDomain = "test"

        sockB.plainUsername = "user"
        sockB.plainPassword = "BAD PASS"

        const address = uniqAddress(proto)
        await sockA.bind(address)
        await sockB.connect(address)

        const eventA = await captureEvent(sockA, "handshake:error:protocol")
        assert.equal(eventA.type, "handshake:error:protocol")
        assert.equal(eventA.address, address)
        assert.instanceOf(eventA.error, Error)
        assert.equal(eventA.error.message, "ZAP protocol error")
        assert.equal(eventA.error.code, "ERR_ZAP_BAD_VERSION")
      })
    })
  })
}

interface ZapDetails {
  domain: string
  mechanism: "NULL" | "PLAIN" | "CURVE"
  credentials: string[]
}

abstract class ZapHandler {
  socket = new zmq.Router

  async run() {
    await this.socket.bind("inproc://zeromq.zap.01")

    /* See https://rfc.zeromq.org/spec:27/ZAP/ */
    for await (const msg of this.socket) {
      await this.socket.send(this.handle(msg))
    }
  }

  stop() {
    this.socket.close()
  }

  protected abstract handle(request: Buffer[]): Array<Buffer | string | null>
}

class ValidatingZapHandler extends ZapHandler {
  details: ZapDetails

  constructor(details: ZapDetails) {
    super()
    this.details = details
    this.run()
  }

  handle(request: Buffer[]) {
    const [
      path,
      delimiter,
      version,
      id,
      domain,
      address,
      identity,
      mechanism,
      ...credentials
    ] = request

    let status = ["200", "OK"]
    if (mechanism.toString() === "NULL" && credentials.length !== 0) {
      status = ["300", "Expected no credentials"]
    } else if (mechanism.toString() === "PLAIN" && credentials.length !== 2) {
      status = ["300", "Expected 2 credentials"]
    } else if (mechanism.toString() === "CURVE" && credentials.length !== 1) {
      status = ["300", "Expected 1 credential"]
    } else if (domain.toString() !== this.details.domain) {
      status = ["400", "Unknown domain"]
    } else {
      for (const [i, credential] of credentials.entries()) {
        if (this.details.credentials[i] !== credential.toString()) {
          status = ["400", "Bad credentials"]
          break
        }
      }
    }

    return [
      path,
      delimiter,
      version,
      id,
      ...status,
      null,
      null,
    ]
  }
}

class CustomZapHandler extends ZapHandler {
  handle: ZapHandler["handle"]

  constructor(handler: ZapHandler["handle"]) {
    super()
    this.handle = handler
    this.run()
  }
}

function captureEvent<E extends zmq.EventType>(
  socket: zmq.Socket,
  event: E,
): Promise<zmq.EventOfType<E>> {
  return new Promise((resolve) => socket.events.on<E>(event, resolve))
}