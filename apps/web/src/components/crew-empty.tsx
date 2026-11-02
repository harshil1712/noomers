import type { ReactNode } from "react";
import { Empty } from "@cloudflare/kumo";
import { CrewSprite } from "@noomers/brand/crew/CrewSprite";

/** Kumo `Empty` with a crew sprite as the (decorative) icon. */
export function CrewEmpty({
  title,
  description,
  contents,
  robot = 0,
  size = "base",
}: {
  title: string;
  description?: string;
  contents?: ReactNode;
  robot?: 0 | 1 | 2 | 3;
  size?: "sm" | "base" | "lg";
}) {
  return (
    <Empty
      size={size}
      icon={<CrewSprite robot={robot} color={`--crew-${robot + 1}`} size={48} />}
      title={title}
      description={description}
      contents={contents}
    />
  );
}
