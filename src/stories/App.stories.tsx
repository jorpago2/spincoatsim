import type { Meta, StoryObj } from "@storybook/react-vite";
import { GlobalTheme } from "@carbon/react";

import App from "../App";
import "../carbon.scss";
import "../styles.css";

const meta = {
  title: "SpinCoatSim/Workbench",
  component: App,
  parameters: { layout: "fullscreen" },
  render: () => <GlobalTheme theme="g10"><App /></GlobalTheme>,
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
