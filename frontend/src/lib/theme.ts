export type Theme = "light" | "dark";

const STORAGE_KEY = "reto-theme";

// Preferencia por navegador. Si el almacenamiento no está disponible, tema claro.
export function readTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Sin almacenamiento: el tema dura solo esta sesión.
  }
}
