/**
 * Typed loader of the Signature Triage fixture (src/data/signature_reference.json, a byte copy of
 * docs/signature_reference/expected_values.json). The assignment below is the compile-time check that the JSON has
 * the `SignatureReference` shape. Evidence, noise floor, LOCO and recovery reference bands are read from here,
 * never hard-coded.
 */

import fixture from "@/data/signature_reference.json";
import secondFixture from "@/data/signature_second_assay.json";
import type { SecondAssayReference, SignatureReference } from "./types";

export const SIGNATURE_REFERENCE: SignatureReference = fixture;

/**
 * The second fixture (src/data/signature_second_assay.json, a byte copy of
 * docs/signature_reference/expected_second_assay.json; addendum T11): second-assay agreement, the 4/4 list, the L-44
 * check and the per-panel cross-check the engine is tested against.
 */
export const SECOND_ASSAY_REFERENCE: SecondAssayReference = secondFixture;
