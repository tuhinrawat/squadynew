// Mock jose library for Jest
module.exports = {
  compactDecrypt: jest.fn(),
  compactEncrypt: jest.fn(),
  jwtDecrypt: jest.fn(),
  jwtEncrypt: jest.fn(),
  SignJWT: jest.fn(),
  jwtVerify: jest.fn(),
  decodeJwt: jest.fn(),
  exportJWK: jest.fn(),
  importJWK: jest.fn(),
  base64url: {
    encode: jest.fn(),
    decode: jest.fn(),
  },
}

