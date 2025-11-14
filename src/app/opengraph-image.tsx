import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Squady - Live Auction Platform'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Squady Logo Circle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 280,
            height: 280,
            borderRadius: '50%',
            background: 'white',
            marginBottom: 40,
          }}
        >
          <svg
            width="180"
            height="180"
            viewBox="0 0 180 180"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="90" cy="90" r="90" fill="#3b82f6" />
            <path
              d="M83.176 43.626a4.102 4.102 0 0 0-5.77 1.092l-7.3 10.649-5.068-7.35-.25-.415L61.602 43l-1.58-2.345L58.428 43l-1.179 1.719h-.025l-7.3 10.649-5.017-7.35-5.055-7.363-1.593 2.358-3.198 4.666-.239.338-9.194 13.371a4.164 4.164 0 1 0 6.912 4.641l7.3-10.624 5.042 7.35.263.402 3.174 4.59 1.593 2.346 1.593-2.308 1.166-1.756h.038l7.275-10.624 5.054 7.35 5.055 7.338 1.593-2.308 3.199-4.703.238-.327 9.169-13.358a4.177 4.177 0 0 0-1.129-5.77"
              fill="white"
              transform="translate(0, 40)"
            />
          </svg>
        </div>

        {/* Text */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: 80,
              fontWeight: 'bold',
              color: 'white',
              letterSpacing: '-0.02em',
              marginBottom: 10,
            }}
          >
            SQUADY
          </div>
          <div
            style={{
              fontSize: 36,
              color: 'rgba(255, 255, 255, 0.9)',
              fontWeight: 500,
            }}
          >
            Live Auction Platform
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}


