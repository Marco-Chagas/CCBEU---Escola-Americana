import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import { fade } from "@remotion/transitions/fade";
import { useVideoConfig } from "remotion";
import { Scene } from "./Scene";

const NAVY = "#0b2a5b";
const RED = "#c8102e";
const GOLD = "#ffc845";
const T = 15;

export const SchoolPromo: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Opening" durationInFrames={90} premountFor={fps}>
        <Scene kicker="CCBEU · ESCOLA AMERICANA" title="Learn English. Live the world." bg={NAVY} accent={GOLD} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={linearTiming({ durationInFrames: T })} />
      <TransitionSeries.Sequence name="Courses" durationInFrames={90} premountFor={fps}>
        <Scene kicker="FOR EVERY AGE" title="Kids · Teens · Adults" subtitle="Do primeiro contato à fluência" bg={RED} accent="white" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={linearTiming({ durationInFrames: T })} />
      <TransitionSeries.Sequence name="Method" durationInFrames={90} premountFor={fps}>
        <Scene kicker="HANDS-ON LEARNING" title="Speak. Create. Connect." subtitle="Inglês como linguagem de ação" bg={NAVY} accent={RED} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
      <TransitionSeries.Sequence name="CTA" durationInFrames={105} premountFor={fps}>
        <Scene kicker="GOIÂNIA" title="Matrículas abertas" subtitle="Venha conhecer o CCBEU" bg={RED} accent={GOLD} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
