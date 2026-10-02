import { createRoot } from "react-dom/client";
import { App } from "./App";
import { expectsTeams } from "./teams";
import "bootstrap/dist/css/bootstrap.min.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(<App embedded={expectsTeams()} />);
