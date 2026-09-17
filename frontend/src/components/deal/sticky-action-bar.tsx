import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { Button, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import { ContractSignSheet } from '@/components/deal/contract-sign-sheet';
import { ContractAlignmentCard } from '@/components/deal/contract-alignment-card';
import { TermsReviewCard } from '@/components/deal/terms-review-card';
import { CreativeBriefCard } from '@/components/deal/creative-brief-card';
import { DeliverablesCard } from '@/components/deal/deliverables-card';
import { ContentApprovalRejectSheet, ContentSubmissionSheet, RevisionRequestSheet } from '@/components/deal/content-submission-sheet';
import { LivePostSheet } from '@/components/deal/live-post-sheet';
import { PaymentDetailsCard } from '@/components/deal/payment-details-card';
import { PaymentTrackingCard } from '@/components/deal/payment-tracking-card';
import { DisputeCard, DisputeDetailSheet } from '@/components/deal/dispute-card';
import { DisputeSheet, type DisputeEvidenceChoice } from '@/components/deal/dispute-sheet';
import { CloseStatusCard } from '@/components/deal/close-status-card';
import { PostCloseCard } from '@/components/deal/post-close-card';
import { RatingSheet } from '@/components/deal/rating-sheet';
import { PostCloseEntrySheet } from '@/components/deal/post-close-entry-sheet';

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
  confirmDealClose,
  fetchPostCloseRatings,
  submitPostCloseRating,
  fetchPostCloseEntries,
  submitPostCloseEntry,
  fetchChatArchiveStatus,
  retryChatArchive,
  getChatArchiveDownload,
  fetchPaymentDetails,
  fetchPaymentTracking,
  fetchDisputes,
  fetchCloseStatus,
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
  raisePaymentDispute,
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
  type DisputeProjection,
  type CloseStatus,
  type PostCloseRatings,
  type PostCloseEntryFeed,
  type ChatArchiveStatus,
  type ChatMessage,
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
import { PostCloseContextFence, forPostCloseContext } from '@/lib/post-close-context-fence';

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
  messages,
  onTransitioned,
}: {
  thread: DealThread;
  userId: string;
  accessToken: string | null;
  messages: ChatMessage[];
  onTransitioned: () => void;
}) {
  // Success haptic on an ordinary successful transition (B2-15/roadmap §2, PR-13).
  // Deal-close and contract-sign are excluded here — those already get
  // `Haptics.notificationAsync(Success)` as part of their WinSpring (PR-14),
  // and firing it twice for the same transition would double the buzz.
  const notifyTransitionSuccess = useCallback(() => {
    if (Platform.OS === 'web') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

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
  const [dispute, setDispute] = useState<DisputeProjection | null>(null);
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [disputeFeedback, setDisputeFeedback] = useState<string | null>(null);
  const [disputeSheetOpen, setDisputeSheetOpen] = useState(false);
  const [disputeDetailOpen, setDisputeDetailOpen] = useState(false);
  const [closeStatus, setCloseStatus] = useState<CloseStatus | null>(null);
  const [closeLoading, setCloseLoading] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeActing, setCloseActing] = useState(false);
  const [closeConfirming, setCloseConfirming] = useState(false);
  const [postCloseRatings, setPostCloseRatings] = useState<PostCloseRatings | null>(null);
  const [sharedEntries, setSharedEntries] = useState<PostCloseEntryFeed | null>(null);
  const [privateEntries, setPrivateEntries] = useState<PostCloseEntryFeed | null>(null);
  const [chatArchive, setChatArchive] = useState<ChatArchiveStatus | null>(null);
  const [postCloseLoading, setPostCloseLoading] = useState(false);
  const [postCloseActing, setPostCloseActing] = useState(false);
  const [postCloseError, setPostCloseError] = useState<string | null>(null);
  const [postCloseStateContext, setPostCloseStateContext] = useState('');
  const [ratingOpen, setRatingOpen] = useState(false);
  const [entryVisibility, setEntryVisibility] = useState<'shared' | 'private' | null>(null);
  const [contentDeliverable, setContentDeliverable] = useState<CanonicalDeliverable | null>(null);
  const [revisionDeliverable, setRevisionDeliverable] = useState<CanonicalDeliverable | null>(null);
  const [rejectedApprovalDeliverable, setRejectedApprovalDeliverable] = useState<CanonicalDeliverable | null>(null);
  const [livePostAction, setLivePostAction] = useState<{ deliverableId: string; mode: 'submit' | 'flag' } | null>(null);
  const [signing, setSigning] = useState(false);
  const alignmentStartRef = useRef<string | null>(null);
  const paymentTrackingRequestRef = useRef(0);
  const paymentTrackingContextRef = useRef('');
  const disputeRequestRef = useRef(0);
  const disputeContextRef = useRef('');
  const closeRequestFenceRef = useRef(0);
  const closeContextRef = useRef('');
  const closeMutationRequestRef = useRef<string | null>(null);
  const closeStatusRef = useRef<CloseStatus | null>(null);
  const postCloseFenceRef = useRef(new PostCloseContextFence());
  const postCloseLoadRequestRef = useRef(0);
  const paymentTrackingContext = `${thread.dealId}:${thread.stage}`;
  paymentTrackingContextRef.current = paymentTrackingContext;
  const disputeContext = `${thread.dealId}:${thread.stage}`;
  disputeContextRef.current = disputeContext;
  const closeContext = `${thread.dealId}:${thread.stage}:${userId}`;
  closeContextRef.current = closeContext;
  closeStatusRef.current = closeStatus;
  const postCloseContext = `${thread.dealId}:${thread.stage}:${userId}`;
  // Ref-only invalidation is safe during render and closes the interval before
  // the layout-effect cleanup: stale private state is also context-keyed below.
  if (postCloseFenceRef.current.switchContext(postCloseContext)) {
    postCloseLoadRequestRef.current += 1;
  }

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

  const loadDispute = useCallback(async (showLoading = false) => {
    if (!['payment', 'closed'].includes(thread.stage)) return null;
    const requestId = ++disputeRequestRef.current;
    const requestContext = `${thread.dealId}:${thread.stage}`;
    if (showLoading) {
      setDisputeLoading(true);
      setDisputeError(null);
    }
    const result = await fetchDisputes(thread.dealId);
    if (requestId !== disputeRequestRef.current || requestContext !== disputeContextRef.current) return null;
    if (result.ok) {
      setDispute(result.data);
      setDisputeError(null);
    } else {
      setDisputeError(result.message);
    }
    setDisputeLoading(false);
    return result;
  }, [thread.dealId, thread.stage]);

  const loadCloseStatus = useCallback(async (showLoading = false) => {
    if (!['payment', 'closed'].includes(thread.stage)) return null;
    const requestFence = ++closeRequestFenceRef.current;
    const requestContext = `${thread.dealId}:${thread.stage}:${userId}`;
    if (showLoading) {
      setCloseLoading(true);
      setCloseError(null);
    }
    const result = await fetchCloseStatus(thread.dealId);
    if (requestFence !== closeRequestFenceRef.current || requestContext !== closeContextRef.current) return null;
    if (result.ok) {
      setCloseStatus(result.data);
      closeStatusRef.current = result.data;
      setCloseError(null);
    } else {
      setCloseError(result.message);
    }
    setCloseLoading(false);
    return result;
  }, [thread.dealId, thread.stage, userId]);

  const loadPostClose = useCallback(async (showLoading = false) => {
    if (thread.stage !== 'closed') return null;
    const requestContext = `${thread.dealId}:${thread.stage}:${userId}`;
    const requestTicket = postCloseFenceRef.current.begin(requestContext);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) return null;
    const loadRequest = ++postCloseLoadRequestRef.current;
    if (showLoading) {
      setPostCloseLoading(true);
      setPostCloseError(null);
    }
    const [ratingsResult, sharedResult, privateResult, archiveResult] = await Promise.all([
      fetchPostCloseRatings(thread.dealId),
      fetchPostCloseEntries(thread.dealId, 'shared'),
      fetchPostCloseEntries(thread.dealId, 'private'),
      fetchChatArchiveStatus(thread.dealId),
    ]);
    if (!postCloseFenceRef.current.isCurrent(requestTicket) || loadRequest !== postCloseLoadRequestRef.current) return null;
    if (ratingsResult.ok) setPostCloseRatings(ratingsResult.data);
    if (sharedResult.ok) setSharedEntries(sharedResult.data);
    if (privateResult.ok) setPrivateEntries(privateResult.data);
    if (archiveResult.ok) setChatArchive(archiveResult.data);
    const failure = [ratingsResult, sharedResult, privateResult, archiveResult].find((result) => !result.ok);
    setPostCloseError(failure && !failure.ok ? failure.message : null);
    setPostCloseLoading(false);
    return { ratingsResult, sharedResult, privateResult, archiveResult };
  }, [thread.dealId, thread.stage, userId]);

  useEffect(() => {
    if (['payment', 'closed'].includes(thread.stage)) void loadDispute(true);
    else {
      disputeRequestRef.current += 1;
      setDispute(null);
      setDisputeError(null);
      setDisputeFeedback(null);
      setDisputeLoading(false);
      setDisputeSheetOpen(false);
      setDisputeDetailOpen(false);
    }
  }, [loadDispute, thread.stage]);

  // A signed-out or switched account must never inherit this account's sensitive
  // local dispute draft, even if the deal route remains mounted briefly.
  useEffect(() => {
    setDisputeSheetOpen(false);
    setDisputeDetailOpen(false);
    setDisputeFeedback(null);
  }, [userId]);

  useEffect(() => {
    if (['payment', 'closed'].includes(thread.stage)) void loadPaymentTracking(true);
    else {
      paymentTrackingRequestRef.current += 1;
      setPaymentTracking(null);
      setPaymentTrackingError(null);
      setPaymentTrackingLoading(false);
    }
  }, [loadPaymentTracking, thread.stage]);

  useEffect(() => {
    closeMutationRequestRef.current = null;
    setCloseActing(false);
    if (['payment', 'closed'].includes(thread.stage)) void loadCloseStatus(true);
    else {
      closeRequestFenceRef.current += 1;
      setCloseStatus(null);
      closeStatusRef.current = null;
      setCloseError(null);
      setCloseLoading(false);
    }
  }, [loadCloseStatus, thread.dealId, thread.stage, userId]);

  useLayoutEffect(() => {
    setPostCloseStateContext(postCloseContext);
    setRatingOpen(false);
    setEntryVisibility(null);
    setPostCloseActing(false);
    setPostCloseRatings(null);
    setSharedEntries(null);
    setPrivateEntries(null);
    setChatArchive(null);
    setPostCloseError(null);
    setPostCloseLoading(false);
    if (thread.stage === 'closed') void loadPostClose(true);
  }, [loadPostClose, postCloseContext, thread.stage]);

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
      if (['payment', 'closed'].includes(thread.stage)) void loadDispute();
      if (['payment', 'closed'].includes(thread.stage)) void loadCloseStatus();
      if (thread.stage === 'closed') void loadPostClose();
      onTransitioned();
    }, [loadBriefs, loadCloseStatus, loadContract, loadDeliverables, loadDispute, loadPaymentDetails, loadPaymentTracking, loadPostClose, loadSummary, loadTerms, onTransitioned, thread.stage]),
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
        notifyTransitionSuccess();
        onTransitioned();
      } else {
        setExclusivityWarning(res.exclusivityWarning); // warn-only → re-confirm
      }
      setActing(false);
    },
    [acting, thread.dealId, onTransitioned, notifyTransitionSuccess],
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
      if (result.ok && result.transitioned) {
        notifyTransitionSuccess();
        onTransitioned();
      }
      setActing(false);
    },
    [acting, loadSummary, loadTerms, onTransitioned, terms?.summary?.id, thread.dealId, notifyTransitionSuccess],
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

  const submitDispute = useCallback(async (description: string, evidence: { kind: 'message' | 'live_post'; id: string }[]) => {
    const actionContext = disputeContextRef.current;
    const actionFence = ++disputeRequestRef.current;
    setDisputeError(null);
    setDisputeFeedback(null);
    const result = await raisePaymentDispute(thread.dealId, description, evidence);
    // A mutation result is never trusted as the visual state. This also covers
    // 409s, timeouts and any ambiguous transport failure without replaying POST.
    const [refreshedDispute] = await Promise.all([
      loadDispute(),
      loadPaymentTracking(),
      Promise.resolve(onTransitioned()),
    ]);
    if (actionContext !== disputeContextRef.current) return { ok: false as const, message: 'The deal changed. Review the current dispute record.', opened: false };
    const opened = refreshedDispute?.ok === true && refreshedDispute.data.current_open !== null;
    if (result.ok && actionFence === disputeRequestRef.current && !opened) {
      setDisputeError('The dispute was submitted, but the current record is still unavailable. Please retry the refresh.');
    }
    if (opened) {
      if (!result.ok) setDisputeFeedback('A dispute is already open. Showing the current record.');
      return { ok: true as const };
    }
    return { ok: false as const, message: result.ok ? 'The dispute result is still being confirmed. Retry only when ready.' : result.message, opened: false };
  }, [loadDispute, loadPaymentTracking, onTransitioned, thread.dealId]);

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

  const submitCloseConfirmation = useCallback(async () => {
    const current = closeStatusRef.current;
    if (closeActing || !current?.available || current.stage !== 'payment' || !current.allowed_actions.can_confirm) return;
    const requestId = closeMutationRequestRef.current ?? Crypto.randomUUID();
    closeMutationRequestRef.current = requestId;
    setCloseActing(true);
    setCloseError(null);
    const result = await confirmDealClose(thread.dealId, requestId);
    const [refreshed] = await Promise.all([
      loadCloseStatus(),
      loadPaymentTracking(),
      Promise.resolve(onTransitioned()),
    ]);
    const side = thread.myRole === 'creator' ? 'creator' : 'brand';
    const confirmed = refreshed?.ok === true
      && refreshed.data.available
      && refreshed.data.confirmations[side].confirmed;
    if (result.ok || confirmed) closeMutationRequestRef.current = null;
    if (!result.ok && !confirmed) setCloseError(result.message);
    setCloseActing(false);
  }, [closeActing, loadCloseStatus, loadPaymentTracking, onTransitioned, thread.dealId, thread.myRole]);

  const confirmClose = useCallback(() => {
    const current = closeStatusRef.current;
    if (!current?.available || !current.allowed_actions.can_confirm) return;
    setCloseConfirming(true);
  }, []);

  const submitRating = useCallback(async (score: number, review: string | null, requestId: string) => {
    if (postCloseActing) return { ok: false as const, message: 'Another post-deal action is in progress.' };
    const requestContext = postCloseContext;
    const requestTicket = postCloseFenceRef.current.begin(requestContext);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) {
      return { ok: false as const, message: 'The active deal changed before this rating started.' };
    }
    setPostCloseActing(true);
    setPostCloseError(null);
    const result = await submitPostCloseRating(thread.dealId, score, review, requestId);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) {
      return { ok: false as const, message: 'The active deal changed before this rating completed.' };
    }
    const refreshed = await loadPostClose();
    if (!postCloseFenceRef.current.isContextCurrent(requestContext)) {
      return { ok: false as const, message: 'The active deal changed before this rating completed.' };
    }
    setPostCloseActing(false);
    if (!result.ok) {
      const side = thread.myRole === 'creator' ? 'creator' : 'brand';
      const accepted = refreshed?.ratingsResult.ok === true && refreshed.ratingsResult.data.status[side];
      if (!accepted) return result;
    }
    return { ok: true as const };
  }, [loadPostClose, postCloseActing, postCloseContext, thread.dealId, thread.myRole]);

  const submitEntry = useCallback(async (body: string, requestId: string) => {
    const visibility = entryVisibility;
    if (!visibility || postCloseActing) return { ok: false as const, message: 'This post-deal draft is no longer active.' };
    const requestContext = postCloseContext;
    const requestTicket = postCloseFenceRef.current.begin(requestContext);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) {
      return { ok: false as const, message: 'The active deal changed before this entry started.' };
    }
    setPostCloseActing(true);
    setPostCloseError(null);
    const result = await submitPostCloseEntry(thread.dealId, visibility, body, requestId);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) {
      return { ok: false as const, message: 'The active deal changed before this entry completed.' };
    }
    await loadPostClose();
    if (!postCloseFenceRef.current.isContextCurrent(requestContext)) {
      return { ok: false as const, message: 'The active deal changed before this entry completed.' };
    }
    setPostCloseActing(false);
    return result.ok ? { ok: true as const } : result;
  }, [entryVisibility, loadPostClose, postCloseActing, postCloseContext, thread.dealId]);

  const loadOlderEntries = useCallback(async (visibility: 'shared' | 'private') => {
    const current = visibility === 'shared' ? sharedEntries : privateEntries;
    if (!current?.next_cursor || postCloseActing) return;
    const requestContext = postCloseContext;
    const requestTicket = postCloseFenceRef.current.begin(requestContext);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) return;
    setPostCloseActing(true);
    setPostCloseError(null);
    const result = await fetchPostCloseEntries(thread.dealId, visibility, current.next_cursor);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) return;
    if (result.ok) {
      const merged = { ...result.data, entries: [...current.entries, ...result.data.entries] };
      if (visibility === 'shared') setSharedEntries(merged);
      else setPrivateEntries(merged);
    } else setPostCloseError(result.message);
    setPostCloseActing(false);
  }, [postCloseActing, postCloseContext, privateEntries, sharedEntries, thread.dealId]);

  const retryArchive = useCallback(async () => {
    if (postCloseActing || !chatArchive?.allowed_actions.can_retry) return;
    const requestContext = postCloseContext;
    const requestTicket = postCloseFenceRef.current.begin(requestContext);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) return;
    setPostCloseActing(true);
    setPostCloseError(null);
    const result = await retryChatArchive(thread.dealId);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) return;
    if (result.ok) setChatArchive(result.data);
    else {
      setPostCloseError(result.message);
      await loadPostClose();
    }
    if (postCloseFenceRef.current.isContextCurrent(requestContext)) setPostCloseActing(false);
  }, [chatArchive, loadPostClose, postCloseActing, postCloseContext, thread.dealId]);

  const downloadArchive = useCallback(async () => {
    if (postCloseActing || !chatArchive?.allowed_actions.can_download) return;
    const requestContext = postCloseContext;
    const requestTicket = postCloseFenceRef.current.begin(requestContext);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) return;
    setPostCloseActing(true);
    setPostCloseError(null);
    const result = await getChatArchiveDownload(thread.dealId);
    if (!postCloseFenceRef.current.isCurrent(requestTicket)) return;
    if (!result.ok) setPostCloseError(result.message);
    else {
      try {
        if (!postCloseFenceRef.current.isCurrent(requestTicket)) return;
        await Linking.openURL(result.url);
      } catch {
        if (postCloseFenceRef.current.isCurrent(requestTicket)) {
          setPostCloseError('The secure chat-record link could not be opened. Please try again.');
        }
      }
    }
    if (postCloseFenceRef.current.isContextCurrent(requestContext)) setPostCloseActing(false);
  }, [chatArchive, postCloseActing, postCloseContext, thread.dealId]);

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
    if (result.ok) {
      notifyTransitionSuccess();
      onTransitioned();
    } else {
      setError(result.message);
    }
    setActing(false);
  }, [acting, deliverables, loadDeliverables, loadPaymentDetails, onTransitioned, paymentDetails, thread.dealId, notifyTransitionSuccess]);

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

  const disputeEvidenceChoices: DisputeEvidenceChoice[] = [
    ...messages
      .filter((message) => Boolean(message.body?.trim()))
      .map((message) => ({
        kind: 'message' as const,
        id: message.id,
        label: `Message from ${message.senderName}`,
        snippet: localPlainSnippet(message.body ?? ''),
      })),
    ...(deliverables?.deliverables.flatMap((deliverable) => {
      const current = deliverable.post_state.current;
      return current ? [{
        kind: 'live_post' as const,
        id: current.id,
        label: `Current live post · ${deliverable.display_name}`,
        snippet: 'Current live-post evidence',
      }] : [];
    }) ?? []),
  ].slice(0, 10);

  const disputeView = () => (
    <DisputeCard
      dispute={dispute}
      loading={disputeLoading}
      error={disputeError}
      feedback={disputeFeedback}
      onRetry={() => void loadDispute(true)}
      onRaise={() => setDisputeSheetOpen(true)}
      onView={() => setDisputeDetailOpen(true)}
    />
  );

  const closeView = () => (
    <CloseStatusCard
      state={closeStatus}
      loading={closeLoading}
      error={closeError}
      acting={closeActing}
      onRetry={() => void loadCloseStatus(true)}
      onConfirm={confirmClose}
    />
  );

  const visiblePostCloseRatings = forPostCloseContext(postCloseContext, postCloseStateContext, postCloseRatings, null);
  const visibleSharedEntries = forPostCloseContext(postCloseContext, postCloseStateContext, sharedEntries, null);
  const visiblePrivateEntries = forPostCloseContext(postCloseContext, postCloseStateContext, privateEntries, null);
  const visibleChatArchive = forPostCloseContext(postCloseContext, postCloseStateContext, chatArchive, null);
  const visiblePostCloseLoading = forPostCloseContext(postCloseContext, postCloseStateContext, postCloseLoading, false);
  const visiblePostCloseActing = forPostCloseContext(postCloseContext, postCloseStateContext, postCloseActing, false);
  const visiblePostCloseError = forPostCloseContext(postCloseContext, postCloseStateContext, postCloseError, null);
  const visibleRatingOpen = forPostCloseContext(postCloseContext, postCloseStateContext, ratingOpen, false);
  const visibleEntryVisibility = forPostCloseContext(postCloseContext, postCloseStateContext, entryVisibility, null);

  const postCloseView = () => (
    <PostCloseCard
      ratings={visiblePostCloseRatings}
      shared={visibleSharedEntries}
      privateNotes={visiblePrivateEntries}
      archive={visibleChatArchive}
      loading={visiblePostCloseLoading}
      acting={visiblePostCloseActing}
      error={visiblePostCloseError}
      onRetry={() => void loadPostClose(true)}
      onRate={() => setRatingOpen(true)}
      onAddShared={() => setEntryVisibility('shared')}
      onAddPrivate={() => setEntryVisibility('private')}
      onMoreShared={() => void loadOlderEntries('shared')}
      onMorePrivate={() => void loadOlderEntries('private')}
      onRetryArchive={() => void retryArchive()}
      onDownloadArchive={() => void downloadArchive()}
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
                <GhostButton className="flex-1 px-3" label="Decline" onPress={() => run(() => declineDeal(thread.dealId))} disabled={acting} />
                <PrimaryButton
                  className="flex-1 px-3"
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
                <PrimaryButton label={acting ? 'Generating…' : 'Generate contract'} onPress={() => runContract(async () => {
                  const result = await generateContract(thread.dealId);
                  if (result.ok) notifyTransitionSuccess();
                  return result;
                })} disabled={acting} />
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
            {disputeView()}
            {closeView()}
          </View>
        );

      case 'closed':
        return <View className="gap-2.5">{deliverablesView()}{paymentDetailsView()}{paymentTrackingView()}{disputeView()}{closeView()}{postCloseView()}</View>;
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
      <DisputeSheet
        visible={disputeSheetOpen}
        dealId={thread.dealId}
        accountId={userId}
        evidenceChoices={disputeEvidenceChoices}
        onClose={() => setDisputeSheetOpen(false)}
        onSubmit={submitDispute}
      />
      <DisputeDetailSheet
        visible={disputeDetailOpen}
        dispute={dispute?.current_open ?? null}
        history={dispute?.history ?? []}
        onClose={() => setDisputeDetailOpen(false)}
      />
      <RatingSheet
        visible={visibleRatingOpen}
        dealId={thread.dealId}
        accountId={userId}
        onClose={() => setRatingOpen(false)}
        onSubmit={submitRating}
      />
      <PostCloseEntrySheet
        visible={visibleEntryVisibility !== null}
        dealId={thread.dealId}
        accountId={userId}
        visibility={visibleEntryVisibility ?? 'shared'}
        onClose={() => setEntryVisibility(null)}
        onSubmit={submitEntry}
      />
      <EditSheet
        visible={closeConfirming}
        onClose={() => { if (!closeActing) setCloseConfirming(false); }}
        title="Confirm close?"
        subtitle="This confirmation is final. Once both sides confirm, the deal thread becomes read-only."
        footer={(
          <View className="gap-2">
            <Button action="secondary" size="lg" onPress={() => setCloseConfirming(false)} isDisabled={closeActing}>
              <ButtonText>Not now</ButtonText>
            </Button>
            <Button
              action="primary"
              size="lg"
              onPress={() => { setCloseConfirming(false); void submitCloseConfirmation(); }}
              isDisabled={closeActing}
            >
              <ButtonText>Confirm close</ButtonText>
            </Button>
          </View>
        )}
      >
        <View className="rounded-panel bg-surface-recess p-4">
          <Text className="font-geist text-secondary text-ink-2">
            Both sides need to confirm before the deal can close.
          </Text>
        </View>
      </EditSheet>
    </>
  );
}

function localPlainSnippet(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/(?:https?:\/\/|www\.)\S+/gi, '[link removed]').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Message evidence';
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
          <Text className="font-geist-semibold text-secondary text-ink">Contract v{state.contract?.version}</Text>
          <Text className="mt-0.5 font-geist text-micro text-ink-3">
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
          <Text className="font-geist-semibold text-secondary text-ink">
            {approval.status === 'pending'
              ? `Maker signature held · waiting for ${approval.checker_name}`
              : approval.status === 'approved'
                ? `Checker approved ${approval.maker_name}'s signature`
                : `Checker rejected ${approval.maker_name}'s signature`}
          </Text>
          {approval.comment ? <Text className="mt-1 font-geist text-micro text-ink-2">{approval.comment}</Text> : null}
          {approval.can_decide ? (
            <View className="mt-2 flex-row gap-2">
              <GhostButton className="flex-1 px-3" label="Reject" onPress={() => onDecision(approval.request_id, 'reject')} disabled={acting} />
              <PrimaryButton className="flex-1 px-3" label="Approve signing" onPress={() => onDecision(approval.request_id, 'approve')} disabled={acting} />
            </View>
          ) : null}
        </View>
      ) : null}

      {maySign ? <PrimaryButton label="Review and sign" onPress={onSign} disabled={acting} /> : null}
      {!state.alignment.signing_enabled && state.alignment.status !== 'processing' && state.alignment.status !== 'not_started' ? (
        <Text className="text-center font-geist text-micro text-ink-2">Review and signing stay disabled until alignment is clear or overridden.</Text>
      ) : null}
      {mySideSigned ? <Text className="text-center font-geist-medium text-secondary text-status-good-label">Your side is signed.</Text> : null}
      {approval?.status === 'rejected' && approval.maker_id === userId ? (
        <Text className="text-center font-geist text-micro text-ink-2">Choose Review and sign to correct and retry.</Text>
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
        <Text className="font-geist-semibold text-secondary text-ink">{label}</Text>
        <Text className="font-geist text-micro text-ink-2" numberOfLines={1}>{detail}</Text>
      </View>
      <Text className={`font-geist-semibold text-micro ${status === 'signed' ? 'text-status-good-label' : 'text-ink-3'}`}>
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
          <Text className="font-geist-medium text-secondary text-ink-2">
            {missing.length} field{missing.length === 1 ? '' : 's'} still needed before summary
          </Text>
          {missing.map((field) => {
            const override = summary.checklist.find((item) => item.key === field.key)?.override;
            const canConfirm = override?.state === 'awaiting_confirmation' && override.proposer_side !== summary.viewer_side;
            return (
              <View key={field.key} className="mt-2 border-t border-hairline pt-2">
                <Text className="font-geist text-secondary text-ink-2">• {field.label}{field.status === 'ambiguous' ? ' — clarify' : ''}</Text>
                {summary.can_act ? (
                  canConfirm ? (
                    <InlineButton label="Confirm discussed" disabled={acting} onPress={() => onAction(() => confirmChecklistOverride(dealId, field.key))} />
                  ) : override?.state === 'awaiting_confirmation' ? (
                    <Text className="mt-1 font-geist text-micro text-ink-3">Waiting for the other side to confirm it was discussed.</Text>
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
            <GhostButton className="flex-1 px-3" label="Not yet" onPress={() => onAction(() => deferTermsSummaryRequest(dealId))} disabled={acting} />
            <PrimaryButton className="flex-1 px-3" label="Confirm request" onPress={() => onAction(() => confirmTermsSummaryRequest(dealId))} disabled={acting} />
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
      <Text className="mb-2 font-geist-medium text-secondary text-ink-2">{label}</Text>
      {children}
      {error ? <Text className="mt-2 font-geist text-secondary text-status-critical">{error}</Text> : null}
    </View>
  );
}

function ButtonRow({ children }: { children: ReactNode }) {
  return <View className="flex-row gap-2">{children}</View>;
}

function Waiting({ text }: { text: string }) {
  return (
    <View className="rounded-2xl bg-surface-recess px-3.5 py-3">
      <Text className="text-center font-geist-medium text-secondary text-ink-2">{text}</Text>
    </View>
  );
}

type ActionButtonProps = { label: string; onPress: () => void; disabled: boolean; className?: string };

// Thin wrappers over ui/button so every deal-room action shares one tier system.
function PrimaryButton({ label, onPress, disabled, className }: ActionButtonProps) {
  return (
    <Button action="primary" onPress={onPress} isDisabled={disabled} accessibilityLabel={label} className={className}>
      <ButtonText>{label}</ButtonText>
    </Button>
  );
}

function GhostButton({ label, onPress, disabled, className }: ActionButtonProps) {
  return (
    <Button action="secondary" onPress={onPress} isDisabled={disabled} accessibilityLabel={label} className={className}>
      <ButtonText>{label}</ButtonText>
    </Button>
  );
}

function InlineButton({ label, onPress, disabled }: ActionButtonProps) {
  return (
    <Button action="secondary" onPress={onPress} isDisabled={disabled} accessibilityLabel={label} className="mt-1 self-start">
      <ButtonText>{label}</ButtonText>
    </Button>
  );
}
