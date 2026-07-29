import React from "react";
import { render, act } from "@testing-library/react-native";
import App from "../App";

test("l'app si avvia senza errori", async () => {
  const { toJSON } = render(<App />);
  await act(async () => {}); // lascia risolvere il caricamento font mockato
  expect(toJSON()).toBeTruthy();
});
