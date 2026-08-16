import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScientificUiProvider } from "@jorpago2/scientific-ui";

import App from "../App";
import "../carbon.scss";
import "../styles.css";
import "@jorpago2/scientific-ui/styles.css";

const meta = {
  title: "SpinCoatSim/Workbench",
  component: App,
  parameters: { layout: "fullscreen" },
  render: () => <ScientificUiProvider theme="light"><App /></ScientificUiProvider>,
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
