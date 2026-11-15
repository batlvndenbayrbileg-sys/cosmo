import { AssistantHome } from "@/components/assistant/AssistantHome";

/**
 * Start screen: Cosmo the health helper, straight away (no crew picker in front). The speaker is recognised from the
 * first words; the daily check-up opens from its button. The crew picker stays at /crew, the ground console at /earth.
 */
export default function Home() {
  return <AssistantHome />;
}
