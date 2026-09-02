import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ContractSignSheet } from '@/components/deal/contract-sign-sheet';
import { ContractAlignmentCard } from '@/components/deal/contract-alignment-card';
import { TermsReviewCard } from '@/components/deal/terms-review-card';
import { CreativeBriefCard } from '@/components/deal/creative-brief-card';
import { DeliverablesCard } from '@/components/deal/deliverables-card';
import { ContentApprovalRejectSheet, ContentSubmissionSheet, RevisionRequestSheet } from '@/components/deal/content-submission-sheet';
import { LivePostSheet } from '@/components/deal/live-post-sheet';
import { PaymentDetailsCard } from '@/components/deal/payment-details-card';
import { PaymentTrackingCard } from '@/components/deal/payment-tracking-card';

import {
  acceptDeal,
  approveContentSubmission,
  acknowledgeCreativeBrief,
  confirmChecklistOverride,
  confirmTermsSummaryRequest,
  declineDeal,
  decideContentApproval,
  decideContractSigning,
  deferTermsSummaryRequest,
  decideTermsSummary,
  confirmLivePosts,
  confirmPaymentReceipt,
  fetchPaymentDetails,
  fetchPaymentTracking,
  flagLivePost,
  fetchContract,
  fetchCreativeBriefs,
  fetchCanonicalDeliverables,
  fetchSummaryChecklist,
  fetchTermsReview,
  getContentDraftDownload,
  generateContract,
  createCreativeBriefVersion,
  getContractDownload,
  overrideContractAlignment,
  proposeChecklistOverride,
  requestContentRevision,
  requestTermsSummary,
  runContractAlignment,
  signContract,
  submitLivePost,
  updateBrandPaymentDetails,
  updateCreatorPaymentDetails,
  updatePaymentMilestoneState,
  updatePaymentTrackingState,
  uploadContentDraft,
  subscribeToTermApprovals,
  type DealThread,
  type ContractState,
  type CreativeBriefContent,
  type CreativeBriefState,
  type CanonicalDeliverableState,
  type CanonicalDeliverable,
  type BrandPaymentDetailsInput,
  type CreatorPaymentDetailsInput,
  type PaymentDetailsState,
  type PaymentTrackingActionResult,
  type PaymentTrackingState,
  type ReportablePaymentState,
  type SummaryChecklist,
  type TermsReviewState,
} from '@/lib/deals';
import {
  fetchPrivateDeliverableLabels,
  setPrivateDeliverableLabel,
  type PrivateDeliverableLabel,
  type PrivateDeliverableLabelMap,
} from '@/lib/private-deliverable-labels';

/**
 * StickyActionBar (task 9.7) — the stage-aware AND role-aware bar above the
 * composer. It shows the right buttons + context for THIS user in THIS stage,
 * per deal-engine.md's per-stage sticky-action-bar tables and rbac.md.
 *
 * The buttons only ever request server-authorized actions. The server remains
 * the source of truth for every role, version, and stage gate.
 *
 * On any successful transition we call onTransitioned() so the screen refetches
 * (stage bar + this bar update immediately on the acting client). NOTE: `deals`
 * isn't on the Realtime publication, so the OTHER participant won't live-update —
 * refetch-on-open covers it for MVP (a known gap for the G4 phone test).
 */
export function StickyActionBar({
  thread,
  userId,
  accessToken,
  onTransitioned,
}: {
  thread: DealThread;
  userId: string;
  accessToken: string | null;
  onTransitioned: () => void;
}) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when accept returns a warn-only exclusivity notice (needs re-confirm).
  const [exclusivityWarning, setExclusivityWarning] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryChecklist | null>(null);
  const [terms, setTerms] = useState<TermsReviewState | null>(null);
  const [termsLoading, setTermsLoading] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [contract, setContract] = useState<ContractState | null>(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [briefs, setBriefs] = useState<CreativeBriefState | null>(null);
  const [briefsLoading, setBriefsLoading] = useState(false);
  const [briefsError, setBriefsError] = useState<string | null>(null);
  const [deliverables, setDeliverables] = useState<CanonicalDeliverableState | null>(null);
  const [deliverablesLoading, setDeliverablesLoading] = useState(false);
  const [deliverablesError, setDeliverablesError] = useState<string | null>(null);
  const [privateLabels, setPrivateLabels] = useState<PrivateDeliverableLabelMap>({});
  const [privateLabelsError, setPrivateLabelsError] = useState<string | null>(null);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetailsState | null>(null);
  const [paymentDetailsLoading, setPaymentDetailsLoading] = useState(false);
  const [paymentDetailsError, setPaymentDetailsError] = useState<string | null>(null);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentTracking, setPaymentTracking] = useState<PaymentTrackingState | null>(null);
  const [paymentTrackingLoading, setPaymentTrackingLoading] = useState(false);
  const [paymentTrackingError, setPaymentTrackingError] = useState<string | null>(null);
  const [contentDeliverable, setContentDeliverable] = useState<CanonicalDeliverable | null>(null);
  const [revisionDeliverable, setRevisionDeliverable] = useState<CanonicalDeliverable | null>(null);
  const [rejectedApprovalDeliverable, setRejectedApprovalDeliverable] = useState<CanonicalDeliverable | null>(null);
  const [livePostAction, setLivePostAction] = useState<{ deliverableId: string; mode: 'submit' | 'flag' } | null>(null);
  const [signing, setSigning] = useState(false);
  const alignmentStartRef = useRef<string | null>(null);
  const paymentTrackingRequestRef = useRef(0);
  const paymentTrackingContextRef = useRef('');
  const paymentTrackingContext = `${thread.dealId}:${thread.stage}`;
  paymentTrackingContextRef.current = paymentTrackingContext;

  const loadSummary = useCallback(async () => {
    if (thread.stage !== 'chatting') return;
    const result = await fetchSummaryChecklist(thread.dealId);
    if (result.ok) setSummary(result.data);
    else setError(result.message);
  }, [thread.dealId, thread.stage]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const loadTerms = useCallback(async (showLoading = false) => {
    if (!['chatting', 'approval', 'creating'].includes(thread.stage)) return;
    if (showLoading) setTermsLoading(true);
    const result = await fetchTermsReview(thread.dealId);
    if (result.ok) {
      setTerms(result.data);
      setTermsError(null);
    } else {
      setTermsError(result.message);
    }
    setTermsLoading(false);
  }, [thread.dealId, thread.stage]);

  useEffect(() => {
    if (['chatting', 'approval', 'creating'].includes(thread.stage)) void loadTerms(true);
    else setTerms(null);
  }, [loadTerms, thread.stage]);
  const loadContract = useCallback(async () => {
    if (thread.stage !== 'approval') return;
    setContractLoading(true);
    const result = await fetchContract(thread.dealId);
    if (result.ok) setContract(result.data);
    else setError(result.message);
    setContractLoading(false);
  }, [thread.dealId, thread.stage]);

  useEffect(() => {
    if (thread.stage === 'approval') void loadContract();
    else setContract(null);
  }, [loadContract, thread.stage]);

  const loadBriefs = useCallback(async (showLoading = false) => {
    if (thread.stage !== 'creating') return;
    if (showLoading) setBriefsLoading(true);
    const result = await fetchCreativeBriefs(thread.dealId);
    if (result.ok) {
      setBriefs(result.data);
      setBriefsError(null);
    } else {
      setBriefsError(result.message);
    }
    setBriefsLoading(false);
  }, [thread.dealId, thread.stage]);

  useEffect(() => {
    if (thread.stage === 'creating') void loadBriefs(true);
    else setBriefs(null);
  }, [loadBriefs, thread.stage]);

  const loadDeliverables = useCallback(async (showLoading = false) => {
    if (!['creating', 'posted', 'payment', 'closed'].includes(thread.stage)) return;
    if (showLoading) {
      setDeliverablesLoading(true);
      setDeliverablesError(null);
    }
    const result = await fetchCanonicalDeliverables(thread.dealId);
    if (result.ok) {
      setDeliverables(result.data);
      setDeliverablesError(null);
      if (thread.stage === 'creating' && thread.myRole === 'creator') {
        const labelResult = await fetchPrivateDeliverableLabels(
          result.data.deliverables.map((deliverable) => deliverable.id),
        );
        if (labelResult.ok) {
          setPrivateLabels(labelResult.data);
          setPrivateLabelsError(null);
        } else {
          setPrivateLabels({});
          setPrivateLabelsError(labelResult.message);
        }
      } else {
        setPrivateLabels({});
        setPrivateLabelsError(null);
      }
    } else {
      setDeliverables(null);
      setDeliverablesError(result.message);
      setPrivateLabels({});
      setPrivateLabelsError(null);
    }
    setDeliverablesLoading(false);
  }, [thread.dealId, thread.myRole, thread.stage]);

  useEffect(() => {
    if (['creating', 'posted', 'payment', 'closed'].includes(thread.stage)) void loadDeliverables(true);
    else {
      setDeliverables(null);
      setPrivateLabels({});
      setPrivateLabelsError(null);
    }
  }, [loadDeliverables, thread.stage]);

  const loadPaymentDetails = useCallback(async (showLoading = false) => {
    if (!['posted', 'payment', 'closed'].includes(thread.stage)) return;
    if (showLoading) {
      setPaymentDetailsLoading(true);
      setPaymentDetailsError(null);
    }
    const result = await fetchPaymentDetails(thread.dealId);
    if (result.ok) {
      setPaymentDetails(result.data);
      setPaymentDetailsError(null);
    } else {
      setPaymentDetailsError(result.message);
    }
    setPaymentDetailsLoading(false);
  }, [thread.dealId, thread.stage]);

  useEffect(() => {
    if (['posted', 'payment', 'closed'].includes(thread.stage)) void loadPaymentDetails(true);
    else {
      setPaymentDetails(null);
      setPaymentDetailsError(null);
    }
  }, [loadPaymentDetails, thread.stage]);

  const loadPaymentTracking = useCallback(async (showLoading = false) => {
    if (!['payment', 'closed'].includes(thread.stage)) return;
    const requestId = ++paymentTrackingRequestRef.current;
    const requestContext = `${thread.dealId}:${thread.stage}`;
    if (showLoading) {
      setPaymentTrackingLoading(true);
      setPaymentTrackingError(null);
    }
    const result = await fetchPaymentTracking(thread.dealId);
    if (requestId !== paymentTrackingRequestRef.current
      || requestContext !== paymentTrackingContextRef.current) return null;
    if (result.ok) {
      setPaymentTracking(result.data);
      setPaymentTrackingError(null);
    } else {
      setPaymentTrackingError(result.message);
    }
    setPaymentTrackingLoading(false);
    return result;
  }, [thread.dealId, thread.stage]);

  useEffect(() => {
    if (['payment', 'closed'].includes(thread.stage)) void loadPaymentTracking(true);
    else {
      paymentTrackingRequestRef.current += 1;
      setPaymentTracking(null);
      setPaymentTrackingError(null);
      setPaymentTrackingLoading(false);
    }
  }, [loadPaymentTracking, thread.stage]);

  // Generation is followed by one authoritative alignment start. The backend
  // reservation makes concurrent participants/idempotent refreshes safe.
  useEffect(() => {
    const contractId = contract?.contract?.id;
    if (!contractId || contract.alignment.status !== 'not_started' || alignmentStartRef.current === contractId) return;
    alignmentStartRef.current = contractId;
    void (async () => {
      const result = await runContractAlignment(thread.dealId);
      if (!result.ok) setError(result.message);
      await loadContract();
    })();
  }, [contract, loadContract, thread.dealId]);

  // Focus is the authoritative fallback when Realtime is disconnected or the
  // final event raced navigation. It also keeps the existing contract state fresh.
  useFocusEffect(
    useCallback(() => {
      void loadTerms();
      if (thread.stage === 'chatting') void loadSummary();
      if (thread.stage === 'approval') void loadContract();
      if (thread.stage === 'creating') void loadBriefs();
      if (['creating', 'posted', 'payment', 'closed'].includes(thread.stage)) void loadDeliverables();
      if (['posted', 'payment', 'closed'].includes(thread.stage)) void loadPaymentDetails();
      if (['payment', 'closed'].includes(thread.stage)) void loadPaymentTracking();
      onTransitioned();
    }, [loadBriefs, loadContract, loadDeliverables, loadPaymentDetails, loadPaymentTracking, loadSummary, loadTerms, onTransitioned, thread.stage]),
  );

  useEffect(() => {
    const summaryId = terms?.summary?.id;
    if (!summaryId) return;
    return subscribeToTermApprovals(summaryId, accessToken, () => {
      void loadTerms();
      onTransitioned();
    });
  }, [accessToken, loadTerms, onTransitioned, terms?.summary?.id]);

  const run = useCallback(
    async (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
      if (acting) return;
      setActing(true);
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.message);
      else onTransitioned();
      setActing(false);
    },
    [acting, onTransitioned],
  );

  const onAccept = useCallback(
    async (acknowledge: boolean) => {
      if (acting) return;
      setActing(true);
      setError(null);
      const res = await acceptDeal(thread.dealId, acknowledge);
      if (!res.ok) setError(res.message);
      else if (res.transitioned) {
        setExclusivityWarning(null);
        onTransitioned();
      } else {
        setExclusivityWarning(res.exclusivityWarning); // warn-only → re-confirm
      }
      setActing(false);
    },
    [acting, thread.dealId, onTransitioned],
  );

  const runSummary = useCallback(
    async (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
      if (acting) return;
      setActing(true);
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.message);
      await loadSummary();
      setActing(false);
    },
    [acting, loadSummary],
  );

  const runTermsDecision = useCallback(
    async (decision: 'approved' | 'issue_raised', comment?: string) => {
      const summaryId = terms?.summary?.id;
      if (!summaryId || acting) return;
      setActing(true);
      setError(null);
      const result = await decideTermsSummary(thread.dealId, summaryId, decision, comment);
      if (!result.ok) setError(result.message);
      await loadTerms();
      if (!result.ok || !result.transitioned) await loadSummary();
      if (result.ok && result.transitioned) onTransitioned();
      setActing(false);
    },
    [acting, loadSummary, loadTerms, onTransitioned, terms?.summary?.id, thread.dealId],
  );

  const runContract = useCallback(
    async (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
      if (acting) return;
      setActing(true);
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.message);
      await loadContract();
      if (result.ok) onTransitioned();
      setActing(false);
    },
    [acting, loadContract, onTransitioned],
  );

  const submitSignature = useCallback(
    async (payload: Parameters<typeof signContract>[1]) => {
      setError(null);
      const result = await signContract(thread.dealId, payload);
      if (!result.ok) {
        setError(result.message);
        return result;
      }
      await loadContract();
      onTransitioned();
      return result;
    },
    [loadContract, onTransitioned, thread.dealId],
  );

  const download = useCallback(async () => {
    if (acting) return;
    setActing(true);
    setError(null);
    const result = await getContractDownload(thread.dealId);
    if (!result.ok) setError(result.message);
    else {
      try {
        await Linking.openURL(result.url);
      } catch {
        setError('The secure download link could not be opened. Please try again.');
      }
    }
    setActing(false);
  }, [acting, thread.dealId]);

  const createBriefVersion = useCallback(async (expectedVersion: number, content: CreativeBriefContent) => {
    if (acting) return;
    setActing(true);
    setBriefsError(null);
    const result = await createCreativeBriefVersion(thread.dealId, expectedVersion, content);
    if (result.ok) setBriefs(result.data);
    else {
      setBriefsError(result.message);
      await loadBriefs();
    }
    setActing(false);
  }, [acting, loadBriefs, thread.dealId]);

  const acknowledgeBrief = useCallback(async (briefId: string) => {
    if (acting) return;
    setActing(true);
    setBriefsError(null);
    const result = await acknowledgeCreativeBrief(thread.dealId, briefId);
    if (result.ok) setBriefs(result.data);
    else {
      setBriefsError(result.message);
      await loadBriefs();
    }
    setActing(false);
  }, [acting, loadBriefs, thread.dealId]);

  const submitContent = useCallback(async (asset: Parameters<typeof uploadContentDraft>[2]) => {
    if (!contentDeliverable || acting) return { ok: false as const, message: 'This deliverable changed. Refresh and try again.' };
    setActing(true);
    setDeliverablesError(null);
    const result = await uploadContentDraft(thread.dealId, contentDeliverable.id, asset);
    if (!result.ok) setDeliverablesError(result.message);
    await loadDeliverables();
    setActing(false);
    return result;
  }, [acting, contentDeliverable, loadDeliverables, thread.dealId]);

  const submitRevisionRequest = useCallback(async (comment: string) => {
    const submission = revisionDeliverable?.current_submission;
    if (!revisionDeliverable || !submission || acting) {
      return { ok: false as const, message: 'This submission changed. Refresh and try again.' };
    }
    setActing(true);
    setDeliverablesError(null);
    const result = await requestContentRevision(
      thread.dealId,
      revisionDeliverable.id,
      submission.id,
      comment,
    );
    if (!result.ok) setDeliverablesError(result.message);
    await loadDeliverables();
    setActing(false);
    return result;
  }, [acting, loadDeliverables, revisionDeliverable, thread.dealId]);

  const downloadContent = useCallback(async (deliverableId: string, revisionId: string) => {
    if (acting) return;
    setActing(true);
    setDeliverablesError(null);
    const result = await getContentDraftDownload(thread.dealId, deliverableId, revisionId);
    if (!result.ok) setDeliverablesError(result.message);
    else {
      try {
        await Linking.openURL(result.url);
      } catch {
        setDeliverablesError('The secure draft link could not be opened. Please try again.');
      }
    }
    setActing(false);
  }, [acting, thread.dealId]);

  const approveContent = useCallback(async (deliverable: CanonicalDeliverable) => {
    const submission = deliverable.current_submission;
    if (!submission || acting) return;
    setActing(true);
    setDeliverablesError(null);
    const result = await approveContentSubmission(thread.dealId, deliverable.id, submission.id);
    if (!result.ok) setDeliverablesError(result.message);
    await loadDeliverables();
    setActing(false);
  }, [acting, loadDeliverables, thread.dealId]);

  const decideApproval = useCallback(async (
    deliverable: CanonicalDeliverable,
    decision: 'approve' | 'reject',
    comment?: string,
  ) => {
    const approval = deliverable.content_approval;
    if (!approval || acting) return { ok: false as const, message: 'This approval changed. Refresh and try again.' };
    if (decision === 'reject' && comment == null) {
      setRejectedApprovalDeliverable(deliverable);
      return { ok: true as const };
    }
    setActing(true);
    setDeliverablesError(null);
    const result = await decideContentApproval(approval.request_id, decision, comment);
    if (!result.ok) setDeliverablesError(result.message);
    await loadDeliverables();
    setActing(false);
    return result;
  }, [acting, loadDeliverables]);

  const changePrivateLabel = useCallback(async (
    deliverableId: string,
    nextLabel: PrivateDeliverableLabel | null,
  ) => {
    if (thread.myRole !== 'creator' || acting || !deliverables) return;
    const previousLabel = privateLabels[deliverableId] ?? null;
    setActing(true);
    setPrivateLabelsError(null);
    setPrivateLabels((current) => ({ ...current, [deliverableId]: nextLabel }));

    const result = await setPrivateDeliverableLabel(deliverableId, nextLabel);
    if (result.ok) {
      setPrivateLabels((current) => ({ ...current, [deliverableId]: result.data }));
    } else {
      setPrivateLabels((current) => ({ ...current, [deliverableId]: previousLabel }));
      setPrivateLabelsError(result.message);
      const refreshed = await fetchPrivateDeliverableLabels(
        deliverables.deliverables.map((deliverable) => deliverable.id),
      );
      if (refreshed.ok) setPrivateLabels(refreshed.data);
    }
    setActing(false);
  }, [acting, deliverables, privateLabels, thread.myRole]);

  const actOnLivePost = useCallback(async (value: string) => {
    const action = livePostAction;
    const deliverable = deliverables?.deliverables.find((item) => item.id === action?.deliverableId);
    if (!action || !deliverable || acting) return { ok: false as const, message: 'This live-post proof changed. Refresh and try again.' };
    const currentVersion = deliverable.post_state.current?.version ?? 0;
    setActing(true);
    setDeliverablesError(null);
    const result = action.mode === 'submit'
      ? await submitLivePost(thread.dealId, deliverable.id, value, currentVersion)
      : await flagLivePost(thread.dealId, deliverable.id, currentVersion, value);
    await loadDeliverables();
    if (result.ok) onTransitioned();
    else setDeliverablesError(result.message);
    setActing(false);
    return result;
  }, [acting, deliverables, livePostAction, loadDeliverables, onTransitioned, thread.dealId]);

  const saveCreatorPaymentDetails = useCallback(async (
    expectedVersion: number,
    input: CreatorPaymentDetailsInput,
  ) => {
    if (paymentSaving) return { ok: false as const, message: 'A save is already in progress.' };
    setPaymentSaving(true);
    setPaymentDetailsError(null);
    const result = await updateCreatorPaymentDetails(thread.dealId, expectedVersion, input);
    await loadPaymentDetails();
    if (!result.ok) setPaymentDetailsError(result.message);
    setPaymentSaving(false);
    return result;
  }, [loadPaymentDetails, paymentSaving, thread.dealId]);

  const saveBrandPaymentDetails = useCallback(async (
    expectedVersion: number,
    input: BrandPaymentDetailsInput,
  ) => {
    if (paymentSaving) return { ok: false as const, message: 'A save is already in progress.' };
    setPaymentSaving(true);
    setPaymentDetailsError(null);
    const result = await updateBrandPaymentDetails(thread.dealId, expectedVersion, input);
    await loadPaymentDetails();
    if (!result.ok) setPaymentDetailsError(result.message);
    setPaymentSaving(false);
    return result;
  }, [loadPaymentDetails, paymentSaving, thread.dealId]);

  const finishPaymentTrackingAction = useCallback(async (
    action: () => Promise<PaymentTrackingActionResult>,
  ): Promise<PaymentTrackingActionResult> => {
    const actionContext = paymentTrackingContextRef.current;
    const actionFence = ++paymentTrackingRequestRef.current;
    setPaymentTrackingError(null);
    const result = await action();
    if (actionContext !== paymentTrackingContextRef.current) return result;
    if (result.ok && actionFence === paymentTrackingRequestRef.current) {
      setPaymentTracking(result.data);
    }
    const refresh = await loadPaymentTracking();
    if (actionContext !== paymentTrackingContextRef.current) return result;
    if (!result.ok && result.stale) {
      setPaymentTrackingError('The payment status changed. Review the refreshed record before trying again.');
    } else if (!result.ok && refresh && !refresh.ok) {
      setPaymentTrackingError(refresh.message);
    }
    return result;
  }, [loadPaymentTracking]);

  const recordAggregatePayment = useCallback((
    expectedVersion: number,
    state?: ReportablePaymentState,
  ) => {
    if (!state) return Promise.resolve({ ok: false as const, message: 'Choose a payment status.' });
    return finishPaymentTrackingAction(() => updatePaymentTrackingState(thread.dealId, expectedVersion, state));
  }, [finishPaymentTrackingAction, thread.dealId]);

  const recordMilestonePayment = useCallback((
    milestoneId: string,
    expectedVersion: number,
    state?: ReportablePaymentState,
  ) => {
    if (!state) return Promise.resolve({ ok: false as const, message: 'Choose a payment status.' });
    return finishPaymentTrackingAction(() => updatePaymentMilestoneState(
      thread.dealId,
      milestoneId,
      expectedVersion,
      state,
    ));
  }, [finishPaymentTrackingAction, thread.dealId]);

  const confirmAggregateReceipt = useCallback((expectedVersion: number) => (
    finishPaymentTrackingAction(() => confirmPaymentReceipt(thread.dealId, expectedVersion))
  ), [finishPaymentTrackingAction, thread.dealId]);

  const confirmMilestoneReceipt = useCallback((milestoneId: string, expectedVersion: number) => (
    finishPaymentTrackingAction(() => confirmPaymentReceipt(thread.dealId, expectedVersion, milestoneId))
  ), [finishPaymentTrackingAction, thread.dealId]);

  const confirmPosts = useCallback(async () => {
    if (acting || !deliverables || !paymentDetails) return;
    const postsAllowed = deliverables.post_confirmation.future_actions.can_confirm_all;
    const detailsAllowed = paymentDetails.allowed_actions.can_confirm_posts;
    if (!postsAllowed || !detailsAllowed) return;
    setActing(true);
    setError(null);
    const result = await confirmLivePosts(
      thread.dealId,
      deliverables.post_confirmation.expected_versions,
      paymentDetails.creator_version,
      paymentDetails.brand_version,
    );
    await Promise.all([loadDeliverables(), loadPaymentDetails()]);
    if (result.ok) onTransitioned();
    else setError(result.message);
    setActing(false);
  }, [acting, deliverables, loadDeliverables, loadPaymentDetails, onTransitioned, paymentDetails, thread.dealId]);

  const openVerifiedPost = useCallback(async (url: string) => {
    if (!/^https:\/\/[^\s]+$/i.test(url)) {
      setDeliverablesError('This verified link cannot be opened safely. Refresh and try again.');
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      setDeliverablesError('The verified post could not be opened. Please try again.');
    }
  }, []);

  // ── Role / relationship derivations (rbac.md + deal-engine.md) ──
  const { stage, myRole } = thread;
  const isInitiator = thread.createdBy === userId;
  const isBrandActor = myRole === 'brand_admin' || myRole === 'brand_maker';
  // Checker can't accept/decline/cancel/close (rbac.md "Deal flow — by stage").
  const canRespond = myRole === 'creator' || isBrandActor;
  const livePostDeliverable = livePostAction
    ? deliverables?.deliverables.find((item) => item.id === livePostAction.deliverableId) ?? null
    : null;

  const deliverablesView = () => deliverables ? (
    <DeliverablesCard
      state={deliverables}
      acting={acting}
      error={deliverablesError ?? privateLabelsError}
      myRole={myRole}
      privateLabels={privateLabels}
      onSubmit={setContentDeliverable}
      onRequestRevision={setRevisionDeliverable}
      onApprove={(deliverable) => void approveContent(deliverable)}
      onApprovalDecision={(deliverable, decision) => { void decideApproval(deliverable, decision); }}
      onDownload={(deliverableId, revisionId) => void downloadContent(deliverableId, revisionId)}
      onPrivateLabelChange={(deliverableId, value) => { void changePrivateLabel(deliverableId, value); }}
      onLivePost={(deliverable) => setLivePostAction({ deliverableId: deliverable.id, mode: 'submit' })}
      onFlagPost={(deliverable) => setLivePostAction({ deliverableId: deliverable.id, mode: 'flag' })}
      onOpenVerifiedPost={(url) => { void openVerifiedPost(url); }}
    />
  ) : deliverablesLoading ? (
    <Waiting text="Loading the agreed deliverables…" />
  ) : (
    <Actions label="Agreed deliverables" error={deliverablesError}>
      <InlineButton label="Retry" onPress={() => void loadDeliverables(true)} disabled={deliverablesLoading} />
    </Actions>
  );

  const paymentDetailsView = () => paymentDetails ? (
    <PaymentDetailsCard
      state={paymentDetails}
      saving={paymentSaving}
      error={paymentDetailsError}
      onSaveCreator={saveCreatorPaymentDetails}
      onSaveBrand={saveBrandPaymentDetails}
    />
  ) : paymentDetailsLoading ? (
    <Waiting text="Loading off-platform payment information…" />
  ) : (
    <Actions label="Off-platform payment information" error={paymentDetailsError}>
      <InlineButton label="Retry" onPress={() => void loadPaymentDetails(true)} disabled={paymentDetailsLoading} />
    </Actions>
  );

  const paymentTrackingView = () => (
    <PaymentTrackingCard
      state={paymentTracking}
      loading={paymentTrackingLoading}
      error={paymentTrackingError}
      isDisputed={thread.isDisputed}
      onRetry={() => void loadPaymentTracking(true)}
      onRecordAggregate={recordAggregatePayment}
      onRecordMilestone={recordMilestonePayment}
      onConfirmAggregate={confirmAggregateReceipt}
      onConfirmMilestone={confirmMilestoneReceipt}
    />
  );

  const termsReview = (readOnly: boolean): ReactNode => {
    if (termsLoading && !terms) return <Waiting text="Loading the terms review…" />;
    if (termsError && !terms) {
      return (
        <Actions label="Terms review" error={termsError}>
          <InlineButton label="Retry" onPress={() => void loadTerms(true)} disabled={termsLoading} />
        </Actions>
      );
    }
    if (!terms?.summary) return null;
    return (
      <TermsReviewCard
        summary={terms.summary}
        userId={userId}
        readOnly={readOnly}
        acting={acting}
        error={error}
        onDecision={runTermsDecision}
      />
    );
  };

  const body = () => {
    switch (stage) {
      case 'pending':
        // The recipient (not the initiator; not a checker) responds.
        if (!isInitiator && canRespond) {
          return (
            <Actions label="Connection request" error={error}>
              {exclusivityWarning ? (
                <View className="mb-2 rounded-xl bg-status-critical-tint px-3 py-2">
                  <Text className="font-geist-medium text-[13px] text-status-critical">{exclusivityWarning}</Text>
                  <Text className="mt-0.5 font-geist text-[12px] text-ink-2">
                    You can still accept — this is a heads-up, not a block.
                  </Text>
                </View>
              ) : null}
              <ButtonRow>
                <GhostButton label="Decline" onPress={() => run(() => declineDeal(thread.dealId))} disabled={acting} />
                <PrimaryButton
                  label={exclusivityWarning ? 'Accept anyway' : 'Accept'}
                  onPress={() => onAccept(exclusivityWarning != null)}
                  disabled={acting}
                />
              </ButtonRow>
            </Actions>
          );
        }
        return <Waiting text={`Waiting for a response${thread.expiresAt ? ` · expires in ${hoursUntil(thread.expiresAt)}h` : ''}`} />;

      case 'chatting':
        return termsReview(false) ?? <SummaryGate summary={summary} dealId={thread.dealId} userId={userId} acting={acting} error={error} onAction={runSummary} />;

      case 'approval':
        if (contractLoading && !contract) return <View className="gap-2.5">{termsReview(true)}<Waiting text="Loading the contract…" /></View>;
        if (!contract?.contract) {
          return (
            <View className="gap-2.5">
              {termsReview(true)}
              <Actions label="Approval — contract" error={error}>
                <PrimaryButton label={acting ? 'Generating…' : 'Generate contract'} onPress={() => runContract(() => generateContract(thread.dealId))} disabled={acting} />
              </Actions>
            </View>
          );
        }
        return (
          <View className="gap-2.5">
            {termsReview(true)}
            <Actions label="Approval — contract" error={error}>
              <ContractCard
                state={contract}
                myRole={myRole}
                userId={userId}
                acting={acting}
                onDownload={download}
                onSign={() => setSigning(true)}
                onDecision={(requestId, decision) => runContract(() => decideContractSigning(requestId, decision))}
                onAlignmentRetry={() => runContract(() => runContractAlignment(thread.dealId))}
                onAlignmentOverride={() => {
                  const extractionId = contract.alignment.extraction_id;
                  if (extractionId) void runContract(() => overrideContractAlignment(thread.dealId, extractionId));
                }}
              />
            </Actions>
          </View>
        );

      case 'creating':
        return (
          <View className="gap-2.5">
            {termsReview(true)}
            {deliverablesView()}
            {briefs ? (
              <CreativeBriefCard
                state={briefs}
                acting={acting}
                error={briefsError}
                onCreateVersion={(expectedVersion, content) => void createBriefVersion(expectedVersion, content)}
                onAcknowledge={(briefId) => void acknowledgeBrief(briefId)}
              />
            ) : briefsLoading ? (
              <Waiting text="Loading the campaign brief…" />
            ) : (
              <Actions label="Campaign brief" error={briefsError}>
                <Text className="font-geist text-[12px] text-ink-3">Brief status is temporarily unavailable.</Text>
              </Actions>
            )}
          </View>
        );

      case 'posted':
        return (
          <View className="gap-2.5">
            {deliverablesView()}
            {paymentDetailsView()}
            {deliverables?.post_confirmation.future_actions.can_confirm_all
              && paymentDetails?.allowed_actions.can_confirm_posts ? (
                <Actions label="Posted — exact confirmation" error={error}>
                  <PrimaryButton label={acting ? 'Confirming…' : 'Confirm posts live'} onPress={() => void confirmPosts()} disabled={acting} />
                </Actions>
              ) : (
                <Waiting text={paymentDetails && (!paymentDetails.creator_complete || !paymentDetails.brand_complete)
                  ? `Payment information missing: ${[
                    !paymentDetails.creator_complete ? 'creator' : null,
                    !paymentDetails.brand_complete ? 'brand' : null,
                  ].filter(Boolean).join(' and ')}`
                  : isBrandActor ? 'Review every current live-post proof before confirming.' : 'Waiting for the brand to confirm the current proof.'} />
              )}
          </View>
        );

      case 'payment':
        return (
          <View className="gap-2.5">
            {deliverablesView()}
            {paymentDetailsView()}
            {paymentTrackingView()}
          </View>
        );

      case 'closed':
        return <View className="gap-2.5">{deliverablesView()}{paymentDetailsView()}{paymentTrackingView()}<Waiting text="This deal is closed." /></View>;
      case 'declined':
        return <Waiting text="This connection was declined." />;
      case 'cancelled':
        return <Waiting text="This deal was cancelled." />;
    }
  };

  return (
    <>
      <View className="border-t border-hairline bg-app px-4 pb-2 pt-3">{body()}</View>
      {contract?.contract ? (
        <ContractSignSheet
          visible={signing}
          dealId={thread.dealId}
          contractId={contract.contract.id}
          onClose={() => setSigning(false)}
          onSign={submitSignature}
        />
      ) : null}
      {contentDeliverable ? (
        <ContentSubmissionSheet
          visible
          roundNumber={contentDeliverable.revision_current + 1}
          roundMax={contentDeliverable.revision_max}
          onClose={() => setContentDeliverable(null)}
          onSubmit={submitContent}
        />
      ) : null}
      {livePostAction && livePostDeliverable ? (
        <LivePostSheet
          deliverable={livePostDeliverable}
          mode={livePostAction.mode}
          onClose={() => setLivePostAction(null)}
          onSubmit={actOnLivePost}
        />
      ) : null}
      {revisionDeliverable?.current_submission ? (
        <RevisionRequestSheet
          visible
          roundNumber={revisionDeliverable.current_submission.round_number}
          onClose={() => setRevisionDeliverable(null)}
          onSubmit={submitRevisionRequest}
        />
      ) : null}
      {rejectedApprovalDeliverable?.content_approval ? (
        <ContentApprovalRejectSheet
          visible
          roundNumber={rejectedApprovalDeliverable.content_approval.round_number}
          onClose={() => setRejectedApprovalDeliverable(null)}
          onSubmit={(comment) => decideApproval(rejectedApprovalDeliverable, 'reject', comment)}
        />
      ) : null}
    </>
  );
}

function ContractCard({
  state,
  myRole,
  userId,
  acting,
  onDownload,
  onSign,
  onDecision,
  onAlignmentRetry,
  onAlignmentOverride,
}: {
  state: ContractState;
  myRole: DealThread['myRole'];
  userId: string;
  acting: boolean;
  onDownload: () => void;
  onSign: () => void;
  onDecision: (requestId: string, decision: 'approve' | 'reject') => void;
  onAlignmentRetry: () => void;
  onAlignmentOverride: () => void;
}) {
  const creator = state.required_signatures.creator;
  const brand = state.required_signatures.brand;
  const approval = state.maker_checker;
  const isBrand = myRole === 'brand_admin' || myRole === 'brand_maker';
  const isCreator = myRole === 'creator';
  const mySideSigned = (isCreator && creator === 'signed') || (isBrand && brand === 'signed');
  const maySign = state.contract?.status === 'awaiting_signatures' && state.alignment.signing_enabled && (isCreator || isBrand) && !mySideSigned && !(isBrand && brand === 'held');

  return (
    <View className="gap-2.5 rounded-2xl border border-hairline bg-surface-card p-3">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="font-geist-semibold text-[14px] text-ink">Contract v{state.contract?.version}</Text>
          <Text className="mt-0.5 font-geist text-[11px] text-ink-3">
            {state.contract?.status === 'executed' ? 'Executed PDF ready' : 'Secure PDF · awaiting signatures'}
          </Text>
        </View>
        <InlineButton label="Download" onPress={onDownload} disabled={acting} />
      </View>

      <View className="rounded-xl bg-surface-recess px-3 py-2">
        <SignerRow label="Creator" status={creator} signature={state.signatures.find((item) => item.side === 'creator')} />
        <View className="my-2 h-px bg-hairline" />
        <SignerRow label="Brand" status={brand} signature={state.signatures.find((item) => item.side === 'brand')} />
      </View>

      <ContractAlignmentCard
        alignment={state.alignment}
        acting={acting}
        onRetry={onAlignmentRetry}
        onOverride={onAlignmentOverride}
      />

      {approval ? (
        <View className={`rounded-xl px-3 py-2 ${approval.status === 'rejected' ? 'bg-status-critical-tint' : approval.status === 'approved' ? 'bg-status-good-tint' : 'bg-cane-1'}`}>
          <Text className="font-geist-semibold text-[12px] text-ink">
            {approval.status === 'pending'
              ? `Maker signature held · waiting for ${approval.checker_name}`
              : approval.status === 'approved'
                ? `Checker approved ${approval.maker_name}'s signature`
                : `Checker rejected ${approval.maker_name}'s signature`}
          </Text>
          {approval.comment ? <Text className="mt-1 font-geist text-[11px] text-ink-2">{approval.comment}</Text> : null}
          {approval.can_decide ? (
            <View className="mt-2 flex-row gap-2">
              <GhostButton label="Reject" onPress={() => onDecision(approval.request_id, 'reject')} disabled={acting} />
              <PrimaryButton label="Approve signing" onPress={() => onDecision(approval.request_id, 'approve')} disabled={acting} />
            </View>
          ) : null}
        </View>
      ) : null}

      {maySign ? <PrimaryButton label="Review and sign" onPress={onSign} disabled={acting} /> : null}
      {!state.alignment.signing_enabled && state.alignment.status !== 'processing' && state.alignment.status !== 'not_started' ? (
        <Text className="text-center font-geist text-[11px] text-ink-2">Review and signing stay disabled until alignment is clear or overridden.</Text>
      ) : null}
      {mySideSigned ? <Text className="text-center font-geist-medium text-[12px] text-status-good-label">Your side is signed.</Text> : null}
      {approval?.status === 'rejected' && approval.maker_id === userId ? (
        <Text className="text-center font-geist text-[11px] text-ink-2">Choose Review and sign to correct and retry.</Text>
      ) : null}
    </View>
  );
}

function SignerRow({
  label,
  status,
  signature,
}: {
  label: string;
  status: 'pending' | 'held' | 'signed';
  signature: ContractState['signatures'][number] | undefined;
}) {
  const detail = signature
    ? `${signature.signer_name} · ${signature.signature_mode === 'print_bypass' ? 'print and sign' : signature.signature_mode}`
    : status === 'held'
      ? 'Held for checker approval'
      : 'Signature pending';
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="min-w-0 flex-1">
        <Text className="font-geist-semibold text-[12px] text-ink">{label}</Text>
        <Text className="font-geist text-[11px] text-ink-2" numberOfLines={1}>{detail}</Text>
      </View>
      <Text className={`font-geist-semibold text-[11px] ${status === 'signed' ? 'text-status-good-label' : 'text-ink-3'}`}>
        {status === 'signed' ? 'Signed' : status === 'held' ? 'Held' : 'Pending'}
      </Text>
    </View>
  );
}

/** The two ordered Chatting gates. This only handles Gate A; no AI output or
 * approval-stage CTA is shown until Phase 10 has a real parser result. */
function SummaryGate({
  summary,
  dealId,
  userId,
  acting,
  error,
  onAction,
}: {
  summary: SummaryChecklist | null;
  dealId: string;
  userId: string;
  acting: boolean;
  error: string | null;
  onAction: (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => void;
}) {
  if (!summary) return <Waiting text="Checking the deal checklist…" />;
  const missing = summary.missing_fields;
  const isRequester = summary.requested_by === userId;
  const isOtherSide = summary.requester_side != null && summary.requester_side !== summary.viewer_side;

  if (missing.length > 0) {
    return (
      <Actions label="Chatting — terms checklist" error={error}>
        <View className="rounded-2xl bg-surface-recess px-3.5 py-3">
          <Text className="font-geist-medium text-[13px] text-ink-2">
            {missing.length} field{missing.length === 1 ? '' : 's'} still needed before summary
          </Text>
          {missing.map((field) => {
            const override = summary.checklist.find((item) => item.key === field.key)?.override;
            const canConfirm = override?.state === 'awaiting_confirmation' && override.proposer_side !== summary.viewer_side;
            return (
              <View key={field.key} className="mt-2 border-t border-hairline pt-2">
                <Text className="font-geist text-[12px] text-ink-2">• {field.label}{field.status === 'ambiguous' ? ' — clarify' : ''}</Text>
                {summary.can_act ? (
                  canConfirm ? (
                    <InlineButton label="Confirm discussed" disabled={acting} onPress={() => onAction(() => confirmChecklistOverride(dealId, field.key))} />
                  ) : override?.state === 'awaiting_confirmation' ? (
                    <Text className="mt-1 font-geist text-[11px] text-ink-3">Waiting for the other side to confirm it was discussed.</Text>
                  ) : (
                    <InlineButton label="Mark as discussed" disabled={acting} onPress={() => onAction(() => proposeChecklistOverride(dealId, field.key))} />
                  )
                ) : null}
              </View>
            );
          })}
        </View>
      </Actions>
    );
  }

  if (summary.request_status === 'idle') {
    return (
      <Actions label="Chatting — next step" error={error}>
        {summary.can_act ? <PrimaryButton label="Request terms summary" onPress={() => onAction(() => requestTermsSummary(dealId))} disabled={acting} /> : <Waiting text="Checklist complete. A creator, brand admin, or maker can request the summary." />}
      </Actions>
    );
  }
  if (summary.request_status === 'awaiting_confirmation') {
    if (summary.can_act && isOtherSide) {
      return (
        <Actions label="Summary requested — confirm" error={error}>
          <ButtonRow>
            <GhostButton label="Not yet" onPress={() => onAction(() => deferTermsSummaryRequest(dealId))} disabled={acting} />
            <PrimaryButton label="Confirm request" onPress={() => onAction(() => confirmTermsSummaryRequest(dealId))} disabled={acting} />
          </ButtonRow>
        </Actions>
      );
    }
    return <Waiting text={isRequester ? 'Waiting for the other side to confirm the summary.' : 'Waiting for an eligible participant on the other side.'} />;
  }
  return <Waiting text="Both sides confirmed. Summary generation is ready; the parser arrives in Phase 10." />;
}

/** Whole hours from now until an ISO timestamp (floored at 0). */
function hoursUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 3_600_000));
}

/* ── Small presentational pieces (tokens only) ── */

function Actions({ label, error, children }: { label: string; error: string | null; children: ReactNode }) {
  return (
    <View>
      <Text className="mb-2 font-geist-semibold text-[10.5px] uppercase tracking-wider text-ink-3">{label}</Text>
      {children}
      {error ? <Text className="mt-2 font-geist text-[12px] text-status-critical">{error}</Text> : null}
    </View>
  );
}

function ButtonRow({ children }: { children: ReactNode }) {
  return <View className="flex-row gap-2">{children}</View>;
}

function Waiting({ text }: { text: string }) {
  return (
    <View className="rounded-2xl bg-surface-recess px-3.5 py-3">
      <Text className="text-center font-geist-medium text-[13px] text-ink-2">{text}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`flex-1 items-center justify-center rounded-full bg-ink py-2.5 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className="font-geist-semibold text-[14px] text-white">{label}</Text>
    </Pressable>
  );
}

function GhostButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`flex-1 items-center justify-center rounded-full border border-hairline bg-surface-card py-2.5 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className="font-geist-semibold text-[14px] text-ink-2">{label}</Text>
    </Pressable>
  );
}

function InlineButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} className={`mt-1 self-start rounded-full bg-cane-2 px-2.5 py-1 ${disabled ? 'opacity-50' : ''}`}>
      <Text className="font-geist-semibold text-[11px] text-ink">{label}</Text>
    </Pressable>
  );
}
