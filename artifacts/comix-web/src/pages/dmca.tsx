export default function DmcaPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">Copyright</p>
      <h1 className="font-serif text-4xl font-bold tracking-tight">DMCA and copyright notices</h1>
      <p className="mt-5 leading-7 text-muted-foreground">ComiHub respects intellectual-property rights. ComiHub is a client-side reader tool and does not host, store, upload, or maintain a library of third-party media files. ComiHub holds zero hosted manga, comic, novel, image, or video files on behalf of users.</p>
      <p className="mt-4 leading-7 text-muted-foreground">For supported client-side paths, 100% of source and media requests execute on the user’s device through the user’s local network connection and IP address. ComiHub provides software and an interface for requesting content from independently operated third-party sources; it does not claim ownership of those works and does not force users to install or use any extension, source configuration, browser helper extension, Android APK, or iOS IPA.</p>

      <div className="prose prose-neutral mt-10 max-w-none dark:prose-invert">
        <h2>Where to send a takedown request</h2>
        <p>If your complaint concerns a hosted file, image, video, page, or other third-party material, please send the copyright takedown notice directly to the third-party website, hosting provider, storage provider, or source operator that actually hosts or controls that material. ComiHub cannot remove a file that it does not host.</p>
        <p>You may also email <a href="mailto:support@comihub.top">support@comihub.top</a> with the subject “Copyright notice” if you believe a ComiHub-controlled link, source listing, optional extension listing, cache path, or other software-controlled access point requires review. We can review and, where applicable, remove or restrict ComiHub-controlled references or access paths, but this does not remove the underlying file from a third-party host.</p>

        <h2>Submit a notice to ComiHub</h2>
        <p>If you are a copyright owner or authorized representative and believe a ComiHub-controlled page, source listing, extension listing, or access path infringes your rights, email <a href="mailto:support@comihub.top">support@comihub.top</a> with the subject “Copyright notice”.</p>
        <p>Please include the following information:</p>
        <ul>
          <li>Your full name and contact information.</li>
          <li>Identification of the copyrighted work or works at issue.</li>
          <li>The specific ComiHub URL, source, extension, or access path, together with enough information for us to locate it.</li>
          <li>The third-party URL or host where the allegedly infringing material is actually stored, if known.</li>
          <li>A statement that you have a good-faith belief the use is not authorized by the rights holder, its agent, or the law.</li>
          <li>A statement that the information in your notice is accurate and that you are authorized to act for the rights holder.</li>
          <li>Your physical or electronic signature.</li>
        </ul>

        <h2>Review and response</h2>
        <p>We review complete notices and may remove or restrict ComiHub-controlled links, source listings, optional extension listings, or other software access paths while investigating. We may also disable ComiHub-controlled proxy or cache paths where applicable. Because ComiHub does not host the underlying third-party media and relies on independent sources, you must also contact the source operator or hosting provider directly for removal of the hosted file.</p>
        <p>We may request additional information before acting on an incomplete, inaccurate, abusive, or misdirected report. A report sent to ComiHub does not replace a notice to the third-party host that controls the material.</p>

        <h2>Good-faith reports</h2>
        <p>Please do not submit knowingly inaccurate or abusive notices. This page describes a contact and review process and does not create a guarantee that every third-party source will be available or that every request can be resolved by ComiHub.</p>
      </div>
    </main>
  );
}

export { DmcaPage };
