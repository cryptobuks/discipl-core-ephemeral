import nacl from 'tweetnacl/nacl-fast'
import { filter, map } from 'rxjs/operators'
import { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } from 'tweetnacl-util'
import { BaseConnector } from 'discipl-core-baseconnector'
import EphemeralClient from './EphemeralClient'
import EphemeralStorage from './EphemeralStorage'

class EphemeralConnector extends BaseConnector {
  constructor () {
    super()
    this.ephemeralClient = new EphemeralStorage()
  }

  getName () {
    return 'ephemeral'
  }

  configure (serverEndpoint, websocketEndpoint, w3cwebsocket) {
    this.ephemeralClient = new EphemeralClient(serverEndpoint, websocketEndpoint, w3cwebsocket)
  }

  async getSsidOfClaim (reference) {
    return { 'pubkey': JSON.parse(encodeUTF8(decodeBase64(reference))).publicKey }
  }

  async getLatestClaim (ssid) {
    return this.ephemeralClient.getLatest(ssid.pubkey)
  }

  async newSsid () {
    let keypair = nacl.sign.keyPair()

    return { 'pubkey': encodeBase64(keypair.publicKey), 'privkey': encodeBase64(keypair.secretKey) }
  }

  async claim (ssid, data) {
    // Sort the keys to get the same message for the same data
    let message = decodeUTF8(JSON.stringify(data, Object.keys(data).sort()))
    let signature = nacl.sign.detached(message, decodeBase64(ssid.privkey))

    let claim = {
      'message': encodeBase64(message),
      'signature': encodeBase64(signature),
      'publicKey': ssid.pubkey
    }

    return this.ephemeralClient.claim(claim)
  }

  async get (reference, ssid = null) {
    let result = await this.ephemeralClient.get(reference)

    let splitReference = JSON.parse(encodeUTF8(decodeBase64(reference)))

    result.data = this._verifySignature(result.data, splitReference.signature, splitReference.publicKey)

    if (result.data == null) {
      return null
    }

    return result
  }

  _verifySignature (data, signature, publicKey) {
    if (data != null) {
      let decodedData = decodeBase64(data)
      if (nacl.sign.detached.verify(decodedData, decodeBase64(signature), decodeBase64(publicKey))) {
        return JSON.parse(encodeUTF8(decodedData))
      }
    }

    return null
  }

  async observe (ssid, claimFilter = {}) {
    let pubkey = ssid ? ssid.pubkey : null
    let subject = this.ephemeralClient.observe(pubkey)

    let processedSubject = subject.pipe(map(claim => {
      claim['claim'].data = this._verifySignature(claim['claim'].data, claim['claim'].signature, claim.ssid.pubkey)
      return claim
    })).pipe(filter(claim => {
      if (claimFilter != null) {
        for (let predicate of Object.keys(claimFilter)) {
          if (claim['claim']['data'][predicate] == null) {
            // Predicate not present in claim
            return false
          }

          if (claimFilter[predicate] != null && claimFilter[predicate] !== claim['claim']['data'][predicate]) {
            // Object is provided in filter, but does not match with actual claim
            return false
          }
        }
      }

      return ssid == null || claim.ssid.pubkey === ssid.pubkey
    })
    )

    return processedSubject
  }
}

export default EphemeralConnector
