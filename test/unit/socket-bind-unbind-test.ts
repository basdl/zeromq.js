import * as zmq from "../../src"

import {assert} from "chai"
import {testProtos, uniqAddress} from "./helpers"

for (const proto of testProtos("tcp", "ipc", "inproc")) {
  describe(`socket with ${proto} bind/unbind`, function() {
    let sock: zmq.Dealer

    beforeEach(function() {
      sock = new zmq.Dealer()
    })

    afterEach(function() {
      sock.close()
      global.gc?.()
    })

    describe("bind", function() {
      it("should resolve", async function() {
        await sock.bind(uniqAddress(proto))
        assert.ok(true)
      })

      it("should throw error if not bound to endpoint", async function() {
        const address = uniqAddress(proto)
        try {
          await sock.unbind(address)
          assert.ok(false)
        } catch (err) {
          assert.instanceOf(err, Error)
          assert.equal(err.message, "No such endpoint")
          assert.equal(err.code, "ENOENT")
          assert.typeOf(err.errno, "number")
          assert.equal(err.address, address)
        }
      })

      it("should throw error for invalid uri", async function() {
        try {
          await sock.bind("foo-bar")
          assert.ok(false)
        } catch (err) {
          assert.instanceOf(err, Error)
          assert.equal(err.message, "Invalid argument")
          assert.equal(err.code, "EINVAL")
          assert.typeOf(err.errno, "number")
          assert.equal(err.address, "foo-bar")
        }
      })

      it("should throw error for invalid protocol", async function() {
        try {
          await sock.bind("foo://bar")
          assert.ok(false)
        } catch (err) {
          assert.instanceOf(err, Error)
          assert.equal(err.message, "Protocol not supported")
          assert.equal(err.code, "EPROTONOSUPPORT")
          assert.typeOf(err.errno, "number")
          assert.equal(err.address, "foo://bar")
        }
      })

      it("should fail during other bind", async function() {
        let promise
        try {
          promise = sock.bind(uniqAddress(proto))
          await sock.bind(uniqAddress(proto))
          assert.ok(false)
        } catch (err) {
          assert.instanceOf(err, Error)
          assert.equal(
            err.message,
            "Socket is blocked by a bind or unbind operation",
          )
          assert.equal(err.code, "EBUSY")
          assert.typeOf(err.errno, "number")
        }
        await promise
      })
    })

    describe("unbind", function() {
      it("should unbind", async function() {
        const address = uniqAddress(proto)
        await sock.bind(address)
        await sock.unbind(address)
        assert.ok(true)
      })

      it("should throw error for invalid uri", async function() {
        try {
          await sock.unbind("foo-bar")
          assert.ok(false)
        } catch (err) {
          assert.instanceOf(err, Error)
          assert.equal(err.message, "Invalid argument")
          assert.equal(err.code, "EINVAL")
          assert.typeOf(err.errno, "number")
          assert.equal(err.address, "foo-bar")
        }
      })

      it("should throw error for invalid protocol", async function() {
        try {
          await sock.unbind("foo://bar")
          assert.ok(false)
        } catch (err) {
          assert.instanceOf(err, Error)
          assert.equal(err.message, "Protocol not supported")
          assert.equal(err.code, "EPROTONOSUPPORT")
          assert.typeOf(err.errno, "number")
          assert.equal(err.address, "foo://bar")
        }
      })

      it("should fail during other unbind", async function() {
        let promise
        const address = uniqAddress(proto)
        await sock.bind(address)
        try {
          promise = sock.unbind(address)
          await sock.unbind(address)
          assert.ok(false)
        } catch (err) {
          assert.instanceOf(err, Error)
          assert.equal(
            err.message,
            "Socket is blocked by a bind or unbind operation",
          )
          assert.equal(err.code, "EBUSY")
          assert.typeOf(err.errno, "number")
        }
        await promise
      })
    })
  })
}
