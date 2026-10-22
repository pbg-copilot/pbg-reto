import { Arrow } from "../shared/ui/ui";

export function HomeScreen({ name, onOpenChat }: { name: string; onOpenChat: () => void }) {
  return <main className="home-screen">
    <section className="home-welcome-card">
      <span className="home-icon">P</span><span className="eyebrow teal">TU ESPACIO DE TRABAJO</span>
      <h1>Hola, {name.split(" ")[0]}.</h1>
      <p>Abre Chat PBG para conversar, revisar información de clientes y gestionar citas desde un solo lugar.</p>
      <button type="button" onClick={onOpenChat}>Abrir Chat PBG <Arrow /></button>
    </section>
    <section className="home-feature-grid" aria-label="Funciones de Chat PBG">
      <article><span>01</span><strong>Conversaciones</strong><p>Retoma el historial de cada cliente con su propio contexto.</p></article>
      <article><span>02</span><strong>Consultas deterministas</strong><p>Revisa perfiles y cotizaciones que constan en los registros.</p></article>
      <article><span>03</span><strong>Agenda</strong><p>Programa citas y revisa cada cambio antes de confirmarlo.</p></article>
    </section>
  </main>;
}
