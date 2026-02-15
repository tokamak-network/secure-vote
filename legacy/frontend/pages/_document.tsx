import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="color-scheme" content="dark" />
      </Head>
      <body className="bg-[#121215] text-[#a3a3a3]">
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
