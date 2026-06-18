export default function ArborSpecPage() {
  const base = import.meta.env.BASE_URL || '/';
  const src = `${base.replace(/\/?$/, '/')}arbor-os-spec.html`;

  return (
    <main style={styles.page}>
      <iframe
        title="Specyfikacja Systemu Polska Flora"
        src={src}
        style={styles.frame}
      />
    </main>
  );
}

const styles = {
  page: {
    width: '100vw',
    minHeight: '100vh',
    margin: 0,
    padding: 0,
    background: '#f6faf7',
    overflow: 'hidden',
  },
  frame: {
    display: 'block',
    width: '100vw',
    height: '100vh',
    border: 0,
    background: '#f6faf7',
  },
};
