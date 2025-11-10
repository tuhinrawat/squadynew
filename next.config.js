/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,
  
  // Optimize images for performance
  images: {
    domains: ['drive.google.com'],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000, // 1 year
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  
  // Enable compression
  compress: true,
  
  // Remove X-Powered-By header
  poweredByHeader: false,
  
  // Use SWC minification for faster builds and smaller bundles
  swcMinify: true,
  
  // Production optimizations
  productionBrowserSourceMaps: false,
  
  // Experimental features for better performance
  experimental: {
    // Enable optimized package imports
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons', 'framer-motion'],
  },
  
  // Compiler optimizations
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  
  // Performance optimizations
  onDemandEntries: {
    // Keep pages in memory for faster navigation
    maxInactiveAge: 60 * 1000, // 60 seconds
    pagesBufferLength: 5,
  },
};

module.exports = nextConfig;
