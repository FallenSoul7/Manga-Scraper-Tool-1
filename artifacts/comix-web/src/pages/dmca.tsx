export default function DmcaPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">Copyright</p>
      <h1 className="font-serif text-4xl font-bold tracking-tight">DMCA and copyright notices</h1>
      <p className="mt-5 leading-7 text-muted-foreground">ComiHub respects intellectual-property rights. ComiHub is a reader interface and content hub; it does not claim ownership of third-party works made available by independent sources or extensions.</p>

      <div className="prose prose-neutral mt-10 max-w-none dark:prose-invert">
        <h2>Submit a notice</h2>
        <p>If you are a copyright owner or authorized representative and believe that a page or source accessible through ComiHub infringes your rights, email <a href="mailto:support@comihub.top">support@comihub.top</a> with the subject “Copyright notice”.</p>
        <p>Please include the following information:</p>
        <ul>
          <li>Your full name and contact information.</li>
          <li>Identification of the copyrighted work or works at issue.</li>
          <li>The specific URL or source, together with enough information for us to locate it.</li>
          <li>A statement that you have a good-faith belief the use is not authorized by the rights holder, its agent, or the law.</li>
          <li>A statement that the information in your notice is accurate and that you are authorized to act for the rights holder.</li>
          <li>Your physical or electronic signature.</li>
        </ul>
        <h2>Review and response</h2>
        <p>We review complete notices and may remove or restrict links, source listings, or other access while investigating. Because ComiHub relies on independent third-party sources, you may also need to contact the source or hosting provider directly. We may request additional information before acting on an incomplete or misdirected report.</p>
        <h2>Good-faith reports</h2>
        <p>Please do not submit knowingly inaccurate or abusive notices. This page describes a contact process and does not create a guarantee that every third-party source will be available or that every request can be resolved by ComiHub.</p>
      </div>
    </main>
  );
}

export { DmcaPage };

