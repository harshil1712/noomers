import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { LinkProvider, Toasty } from "@cloudflare/kumo";
import { appToastManager } from "./lib/toast";
import { RouterAnchor } from "./lib/router-link";
import { routeTree } from "./routeTree.gen";
import "./index.css";

// The theme is applied before first paint by the inline boot script in
// index.html (mirrors THEME_BOOT_SCRIPT from @noomers/brand/theme).

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function Root() {
  return (
    <Toasty toastManager={appToastManager}>
      {/* Kumo Link / LinkButton / Sidebar hrefs navigate through the router. */}
      <LinkProvider component={RouterAnchor}>
        <RouterProvider router={router} />
      </LinkProvider>
    </Toasty>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Root />);
