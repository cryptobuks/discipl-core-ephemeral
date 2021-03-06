import { Subject } from 'rxjs'
import { BaseConnector } from '@discipl/core-baseconnector'
import forge from 'node-forge'
import stringify from 'json-stable-stringify'
import CryptoUtil from './CryptoUtil'

/**
 * EphemeralStorage is responsible for managing claims. It validates the signature when the claim comes in.
 */
class EphemeralStorage {
  constructor () {
    this.storage = {}
    this.claimOwners = {}
    this.fingerprints = {}
    this.globalObservers = []
  }

  async claim (claim) {
    let verification = await this._verifySignature(claim)

    if (verification !== true) {
      return null
    }

    let signature = claim.signature
    let message = claim.message

    let publicKey = claim.publicKey
    this._lazyInitStorage(publicKey)

    let claimId = signature

    if (Object.keys(this.storage[publicKey]['claims']).includes(claimId)) {
      return claimId
    }

    this.claimOwners[claimId] = publicKey
    this.storage[publicKey]['claims'][claimId] = { 'data': message, 'signature': signature, 'previous': this.storage[publicKey]['last'], 'access': [] }
    this.storage[publicKey]['last'] = claimId

    if (Object.keys(message).includes(BaseConnector.ALLOW) || claim.access) {
      let access = message[BaseConnector.ALLOW] || claim.access
      let object = this.storage[publicKey]

      if (BaseConnector.isLink(access.scope) && this.claimOwners[BaseConnector.referenceFromLink(access.scope)] === publicKey) {
        object = this.storage[publicKey]['claims'][BaseConnector.referenceFromLink(access.scope)]
      }

      if (access.did == null) {
        object['access'] = true
      } else {
        if (object['access'] !== true) {
          if (BaseConnector.isDid(access.did)) {
            object['access'].push(BaseConnector.referenceFromDid(access.did))
          }
        }
      }
    }

    for (let listener of this.storage[publicKey].observers.concat(this.globalObservers)) {
      let sourceClaim = this.storage[publicKey]['claims'][claimId]
      let claim = {
        'data': sourceClaim.data,
        'signature': sourceClaim.signature,
        'previous': sourceClaim.previous
      }

      if (this._hasAccessTo(claimId, listener.owner)) {
        listener.subject.next({ 'claim': claim, 'pubkey': publicKey })
      }
    }

    return claimId
  }

  _hasAccessTo (claimId, pubkey) {
    let claimPublicKey = this.claimOwners[claimId]

    if (claimPublicKey === pubkey) {
      return true
    }

    if (claimPublicKey == null) {
      return false
    }

    for (let accessObject of [this.storage[claimPublicKey]['access'], this.storage[claimPublicKey]['claims'][claimId]['access']]) {
      if (accessObject === true) {
        return true
      } else {
        if (accessObject.includes(pubkey)) {
          return true
        }
      }
    }

    return false
  }

  async get (claimId, accessorPubkey, accessorSignature) {
    if (accessorPubkey != null && accessorSignature != null) {
      let cert = await this.getCertForFingerprint(accessorPubkey)
      CryptoUtil.verifySignature(claimId, accessorSignature, cert)
    }

    let publicKey = this.claimOwners[claimId]

    if (Object.keys(this.storage).includes(publicKey) && Object.keys(this.storage[publicKey]['claims']).includes(claimId)) {
      let sourceClaim = this.storage[publicKey]['claims'][claimId]
      let claim = {
        'data': sourceClaim.data,
        'signature': sourceClaim.signature,
        'previous': sourceClaim.previous
      }
      if (this._hasAccessTo(claimId, accessorPubkey)) {
        return claim
      }
    }
  }

  async getLatest (publicKey) {
    if (Object.keys(this.storage).includes(publicKey) && this.storage[publicKey]['last'] != null) {
      return this.storage[publicKey]['last']
    }
  }

  async getPublicKey (claimId) {
    return this.claimOwners[claimId]
  }

  async storeCert (reference, cert) {
    this.fingerprints[reference] = cert
  }

  async getCertForFingerprint (fingerprint) {
    return this.fingerprints[fingerprint]
  }

  async observe (publicKey = null, accessorPubkey = null, accessorSignature = null) {
    if (accessorPubkey != null && accessorSignature != null) {
      let message = publicKey == null ? 'null' : publicKey

      let cert = await this.getCertForFingerprint(accessorPubkey)
      CryptoUtil.verifySignature(message, accessorSignature, cert)
    }

    let subject = new Subject()
    let listener = {
      'subject': subject,
      'owner': accessorPubkey
    }
    if (publicKey !== null) {
      this._lazyInitStorage(publicKey)

      this.storage[publicKey].observers.push(listener)
    } else {
      this.globalObservers.push(listener)
    }

    return [subject, Promise.resolve()]
  }

  async _verifySignature (claim) {
    if (claim.message != null && claim.signature != null && claim.publicKey != null) {
      let cert = await this.getCertForFingerprint(claim.publicKey)

      const md = forge.md.sha256.create()
      md.update(stringify(claim.message), 'utf8')
      const data = md.digest().bytes()

      return cert.publicKey.verify(data, forge.util.decode64(claim.signature))
    }
  }

  _lazyInitStorage (publicKey) {
    if (!Object.keys(this.storage).includes(publicKey)) {
      this.storage[publicKey] = { 'claims': {}, 'last': null, 'observers': [], 'access': [] }
    }
  }
}

export default EphemeralStorage
