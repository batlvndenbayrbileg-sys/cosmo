import { SignatureDemo } from "@/components/signature/SignatureDemo";
import checkinsJson from "@/data/demo_checkins.json";
import { buildDemoBeats, type DemoCheckins } from "@/lib/signature/demo";
import { buildSignatureView } from "@/lib/signature/view";
import { SIGNATURE_DEMO_AUDIO_URL, listSignatureDemoAudio } from "@/server/signature/demoAudio";
import { getLabData, tryLoadSecondAssay } from "@/server/signature/files";

/**
 * /demo/signature : the offline scripted demo of Signature Triage (addendum section 5; build prompt T9). Everything is
 * computed here on the server from the NASA CSVs, the fixture-checked engine, the templates and the simulated
 * check-ins (src/data/demo_checkins.json); the client page only steps through the beats. No Anthropic or ElevenLabs
 * call: Cosmo's lines are templates, and a beat plays its pre-generated clip only when the file exists.
 */
export default function SignatureDemoPage() {
  const checkins = checkinsJson as unknown as DemoCheckins;
  const view = buildSignatureView(getLabData(), tryLoadSecondAssay()?.matrix);
  const beats = buildDemoBeats(view, checkins);
  return <SignatureDemo view={view} beats={beats} audioBase={SIGNATURE_DEMO_AUDIO_URL} audioFiles={listSignatureDemoAudio()} />;
}
