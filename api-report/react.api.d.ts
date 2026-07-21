// API report for @hedgerow/react — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

import * as React from "react";
import { ReactNode } from "react";
import { SortOrder, CommentNode, ThreadResult, PostStats, Actor, LikesResult, Like, Comment, Label } from "@hedgerow/comments";
export { Actor, BlockedNode, Comment, CommentNode, HedgerowFetchError, Label, Like, LikesResult, NotFoundNode, PostStats, SortOrder, ThreadResult, atUriToBskyUrl, resolvePostUri, sortReplies } from "@hedgerow/comments";
type ClassNameProp<State> = string | ((state: State) => string | undefined);
type StyleProp<State> = React.CSSProperties | ((state: State) => React.CSSProperties | undefined);
type RenderFnProps = React.HTMLAttributes<any> & {
    ref?: React.Ref<any>;
    [dataAttr: `data-${string}`]: string | number | boolean | undefined;
};
type ElementProps = React.HTMLAttributes<Element> & {
    [key: string]: unknown;
};
type RenderProp<State> = React.ReactElement | ((props: RenderFnProps, state: State) => React.ReactElement);
interface HeadlessProps<State> {
    render?: RenderProp<State>;
    className?: ClassNameProp<State>;
    style?: StyleProp<State>;
    children?: React.ReactNode;
}
type PartProps<State, Tag extends keyof React.JSX.IntrinsicElements> = HeadlessProps<State> & Omit<React.ComponentPropsWithoutRef<Tag>, "className" | "style" | "children">;
declare function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T>;
declare function chainHandlers<Args extends unknown[]>(ours: ((...args: Args) => void) | undefined, theirs: ((...args: Args) => void) | undefined): ((...args: Args) => void) | undefined;
interface RenderElementParams<State> {
    state: State;
    render?: RenderProp<State>;
    className?: ClassNameProp<State>;
    style?: StyleProp<State>;
    ref?: React.Ref<Element>;
    props: ElementProps;
}
declare function renderElement<State>(defaultTag: keyof React.JSX.IntrinsicElements, { state, render, className, style, ref, props }: RenderElementParams<State>): React.ReactElement;
declare function dataAttrs(state: Record<string, string | number | boolean | undefined>): Record<`data-${string}`, string | number>;
interface EditorFields {
    title: string;
    markdown: string;
}
type EditorStatus = "loading" | "idle" | "dirty" | "saving" | "saved" | "error";
interface UseEditorOptions {
    document: EditorFields | null;
    onSave: (fields: EditorFields) => Promise<void>;
}
interface UseEditorReturn {
    status: EditorStatus;
    isLoading: boolean;
    isDirty: boolean;
    isSaving: boolean;
    isSaved: boolean;
    isError: boolean;
    error: unknown;
    title: string;
    markdown: string;
    setTitle: (title: string) => void;
    setMarkdown: (markdown: string) => void;
    save: () => Promise<void>;
}
declare function useEditor(options: UseEditorOptions): UseEditorReturn;
interface EditorRootState {
    status: UseEditorReturn["status"];
    isLoading: boolean;
    isDirty: boolean;
    isSaving: boolean;
    isSaved: boolean;
    isError: boolean;
}
interface EditorRootProps extends UseEditorOptions, HeadlessProps<EditorRootState>, Omit<React.ComponentPropsWithoutRef<"form">, "className" | "style" | "children" | "onSubmit" | "defaultValue"> {
}
interface EditorTitleState {
    value: string;
    isLoading: boolean;
    isSaving: boolean;
}
type EditorTitleProps = HeadlessProps<EditorTitleState> & Omit<React.ComponentPropsWithoutRef<"input">, "className" | "style" | "children" | "value" | "onChange">;
interface EditorBodySlot {
    value: string;
    onChange: (value: string) => void;
}
interface EditorBodyState {
    value: string;
    isLoading: boolean;
    isSaving: boolean;
}
interface EditorBodyProps extends Omit<React.ComponentPropsWithoutRef<"textarea">, "className" | "style" | "children" | "value" | "onChange" | "slot"> {
    className?: ClassNameProp<EditorBodyState>;
    style?: StyleProp<EditorBodyState>;
    slot?: (slot: EditorBodySlot) => React.ReactNode;
}
interface EditorSaveState {
    isDirty: boolean;
    isSaving: boolean;
    isDisabled: boolean;
}
type EditorSaveProps = PartProps<EditorSaveState, "button">;
interface EditorStatusState {
    status: EditorStatus;
    error: unknown;
}
type EditorStatusProps = PartProps<EditorStatusState, "div">;
type ReplyStatus = "idle" | "submitting" | "error";
interface ReplySession {
    did: string;
    handle: string;
    displayName?: string;
}
interface UseReplyOptions {
    session: ReplySession | null;
    onSubmit: (text: string) => Promise<void | false>;
    onSubmitted?: () => void;
    defaultValue?: string;
}
interface UseReplyReturn {
    session: ReplySession | null;
    isSignedIn: boolean;
    status: ReplyStatus;
    isSubmitting: boolean;
    isError: boolean;
    error: unknown;
    value: string;
    setValue: (value: string) => void;
    submit: () => Promise<void>;
}
declare function useReply(options: UseReplyOptions): UseReplyReturn;
interface ReplyRootState {
    status: UseReplyReturn["status"];
    isSignedIn: boolean;
    isSubmitting: boolean;
    isError: boolean;
}
interface ReplyRootProps extends UseReplyOptions, HeadlessProps<ReplyRootState>, Omit<React.ComponentPropsWithoutRef<"form">, "className" | "style" | "children" | "onSubmit" | "defaultValue"> {
}
interface ReplyFieldState {
    value: string;
    isSubmitting: boolean;
    isSignedIn: boolean;
}
type ReplyFieldProps = HeadlessProps<ReplyFieldState> & Omit<React.ComponentPropsWithoutRef<"textarea">, "className" | "style" | "children" | "value" | "onChange">;
interface ReplySubmitState {
    isSubmitting: boolean;
    isDisabled: boolean;
    isSignedIn: boolean;
}
type ReplySubmitProps = PartProps<ReplySubmitState, "button">;
type ReplySignedInProps = PartProps<Record<string, never>, "div">;
type ReplySignedOutProps = PartProps<Record<string, never>, "div">;
interface ReplyErrorState {
    error: unknown;
}
type ReplyErrorProps = PartProps<ReplyErrorState, "div">;
type RequestStatus = "idle" | "loading" | "success" | "error";
type DeliveryState = "pending" | "confirmed" | "unconfirmed";
interface OptimisticReplyInput {
    ref: {
        uri: string;
        cid: string;
    };
    parentUri: string;
    text: string;
    author: Actor;
    createdAt?: string;
}
interface UseCommentsOptions {
    post: string;
    sort?: SortOrder;
    maxDepth?: number;
    filter?: (node: CommentNode) => boolean;
    initialData?: ThreadResult;
    data?: ThreadResult;
    onRefetch?: () => void;
    appView?: string;
    fetchImpl?: typeof fetch;
    cacheTtlMs?: number;
    optimisticGiveUpAfter?: number;
    revalidateOnMount?: boolean;
    confirmRetryDelays?: number[];
}
interface UseCommentsReturn {
    status: RequestStatus;
    data: ThreadResult | undefined;
    error: unknown;
    root: CommentNode | undefined;
    stats: PostStats | undefined;
    postUrl: string | undefined;
    comments: CommentNode[];
    sort: SortOrder;
    setSort: (sort: SortOrder) => void;
    refetch: () => void;
    isIdle: boolean;
    isLoading: boolean;
    isRevalidating: boolean;
    isSuccess: boolean;
    isError: boolean;
    isEmpty: boolean;
    addOptimisticReply: (input: OptimisticReplyInput) => void;
    deliveryStateOf: (uri: string) => DeliveryState | undefined;
}
declare function useComments(options: UseCommentsOptions): UseCommentsReturn;
interface UseLikesOptions {
    post: string;
    pageSize?: number;
    maxPages?: number;
    initialData?: LikesResult;
    data?: LikesResult;
    onRefetch?: () => void;
    appView?: string;
    fetchImpl?: typeof fetch;
    cacheTtlMs?: number;
    revalidateOnMount?: boolean;
}
interface UseLikesReturn {
    status: RequestStatus;
    data: LikesResult | undefined;
    error: unknown;
    likes: Like[];
    total: number;
    cursor: string | undefined;
    refetch: () => void;
    isIdle: boolean;
    isLoading: boolean;
    isRevalidating: boolean;
    isSuccess: boolean;
    isError: boolean;
    isEmpty: boolean;
}
declare function useLikes(options: UseLikesOptions): UseLikesReturn;
interface UseLikeButtonOptions {
    liked: boolean | undefined;
    count: number;
    onLike: () => void | Promise<void>;
    onUnlike: () => void | Promise<void>;
    disabled?: boolean;
}
interface UseLikeButtonReturn {
    liked: boolean | undefined;
    count: number;
    isBusy: boolean;
    isDisabled: boolean;
    toggle: () => Promise<void>;
}
declare function useLikeButton(options: UseLikeButtonOptions): UseLikeButtonReturn;
interface CommentsRootState {
    status: UseCommentsReturn["status"];
    isEmpty: boolean;
    count: number;
}
interface CommentsRootProps extends Omit<UseCommentsOptions, "sort">, HeadlessProps<CommentsRootState>, Omit<React.ComponentPropsWithoutRef<"div">, "className" | "style" | "children"> {
    sort?: SortOrder;
    onLikeComment?: (node: Comment) => void | Promise<void>;
    onUnlikeComment?: (node: Comment) => void | Promise<void>;
    onReplyToComment?: (node: Comment) => void | Promise<void>;
    isCommentLiked?: (node: Comment) => boolean | undefined;
}
interface CommentsProviderProps {
    value: UseCommentsReturn;
    onLikeComment?: (node: Comment) => void | Promise<void>;
    onUnlikeComment?: (node: Comment) => void | Promise<void>;
    onReplyToComment?: (node: Comment) => void | Promise<void>;
    isCommentLiked?: (node: Comment) => boolean | undefined;
    children?: React.ReactNode;
}
declare function Provider$1({ value, onLikeComment, onUnlikeComment, onReplyToComment, isCommentLiked, children, }: CommentsProviderProps): React.ReactElement;
interface CommentsItemScopeProps {
    node: CommentNode;
    depth?: number;
    index?: number;
    children?: React.ReactNode;
}
declare function ItemScope({ node, depth, index, children }: CommentsItemScopeProps): React.ReactElement;
interface CommentsListState {
    count: number;
    isEmpty: boolean;
}
type CommentsListProps = PartProps<CommentsListState, "div">;
interface CommentsItemState {
    node: CommentNode;
    depth: number;
    index: number;
    kind: CommentNode["type"];
    isComment: boolean;
    isStub: boolean;
    hasReplies: boolean;
    labels: Label[];
    deliveryState: DeliveryState | undefined;
    isEntering: boolean;
}
type CommentsItemProps = PartProps<CommentsItemState, "div">;
interface CommentsRepliesState {
    count: number;
    depth: number;
}
type CommentsRepliesProps = Omit<PartProps<CommentsRepliesState, "div">, "children">;
interface CommentsAuthorState {
    author: Comment["author"];
    node: Comment;
}
type CommentsAuthorProps = PartProps<CommentsAuthorState, "span">;
type CommentsAvatarProps = PartProps<CommentsAuthorState, "img">;
interface CommentsContentState {
    text: string;
    node: Comment;
}
type CommentsContentProps = PartProps<CommentsContentState, "div">;
interface CommentsTimestampState {
    date: Date;
    node: Comment;
}
interface CommentsTimestampProps extends PartProps<CommentsTimestampState, "time"> {
    format?: (date: Date) => string;
}
interface CommentsLikeCountState {
    count: number;
    node: Comment;
}
type CommentsLikeCountProps = PartProps<CommentsLikeCountState, "span">;
interface CommentsLikeButtonState {
    node: Comment;
    liked: boolean | undefined;
    count: number;
    isBusy: boolean;
    isDisabled: boolean;
}
type CommentsLikeButtonProps = Omit<PartProps<CommentsLikeButtonState, "button">, "onClick" | "disabled">;
interface CommentsReplyButtonState {
    node: Comment;
}
type CommentsReplyButtonProps = Omit<PartProps<CommentsReplyButtonState, "button">, "onClick">;
interface CommentsLabelsState {
    labels: Label[];
}
type CommentsLabelsProps = PartProps<CommentsLabelsState, "span">;
interface CommentsFallbackState {
    kind: "blocked" | "notFound";
    node: CommentNode;
}
type CommentsFallbackProps = PartProps<CommentsFallbackState, "div">;
interface CommentsStatsState extends PostStats {
    postUrl: string | undefined;
}
type CommentsStatsProps = PartProps<CommentsStatsState, "div">;
interface CommentsReplyLinkState {
    href: string;
    node: CommentNode | undefined;
    isRoot: boolean;
}
type CommentsReplyLinkProps = PartProps<CommentsReplyLinkState, "a">;
type CommentsLoadingProps = PartProps<Record<string, never>, "div">;
interface CommentsErrorState {
    error: unknown;
}
type CommentsErrorProps = PartProps<CommentsErrorState, "div">;
type CommentsEmptyProps = PartProps<Record<string, never>, "div">;
interface LikesRootState {
    status: UseLikesReturn["status"];
    total: number;
    isEmpty: boolean;
}
interface LikesRootProps extends UseLikesOptions, HeadlessProps<LikesRootState>, Omit<React.ComponentPropsWithoutRef<"div">, "className" | "style" | "children"> {
}
interface LikesProviderProps {
    value: UseLikesReturn;
    children?: React.ReactNode;
}
declare function Provider({ value, children }: LikesProviderProps): React.ReactElement;
interface LikesCountState {
    total: number;
}
type LikesCountProps = PartProps<LikesCountState, "span">;
interface LikeButtonState {
    liked: boolean | undefined;
    count: number;
    isBusy: boolean;
    isDisabled: boolean;
}
interface LikeButtonProps extends UseLikeButtonOptions, HeadlessProps<LikeButtonState>, Omit<React.ComponentPropsWithoutRef<"button">, "className" | "style" | "children" | "disabled" | "onClick"> {
}
interface LikesAvatarsState {
    count: number;
    total: number;
}
interface LikesAvatarsProps extends PartProps<LikesAvatarsState, "div"> {
    max?: number;
}
interface LikeAvatarState {
    like: Like;
    actor: Like["actor"];
}
type LikeAvatarProps = PartProps<LikeAvatarState, "img">;
type LikesLoadingProps = PartProps<Record<string, never>, "div">;
type LikesEmptyProps = PartProps<Record<string, never>, "div">;
interface LikesErrorState {
    error: unknown;
}
type LikesErrorProps = PartProps<LikesErrorState, "div">;
declare function useCommentNode(): CommentNode;
interface CommentsContextValue extends UseCommentsReturn {
    onLikeComment?: (node: Comment) => void | Promise<void>;
    onUnlikeComment?: (node: Comment) => void | Promise<void>;
    onReplyToComment?: (node: Comment) => void | Promise<void>;
    isCommentLiked?: (node: Comment) => boolean | undefined;
}
declare function useCommentsContext(): CommentsContextValue;
interface CommentsItemContextValue {
    node: CommentNode;
    depth: number;
    index: number;
    template: ReactNode;
}
declare function useCommentItemContext(): CommentsItemContextValue;
declare function useOptionalCommentItem(): CommentsItemContextValue | null;
declare function useLikesContext(): UseLikesReturn;
declare function useLikeItemContext(): Like;
declare function useReplyContext(): UseReplyReturn;
declare function useEditorContext(): UseEditorReturn;
declare const Comments: {
    readonly Root: React.ForwardRefExoticComponent<CommentsRootProps & React.RefAttributes<HTMLDivElement>>;
    readonly Provider: typeof Provider$1;
    readonly List: React.ForwardRefExoticComponent<HeadlessProps<CommentsListState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly Item: React.ForwardRefExoticComponent<HeadlessProps<CommentsItemState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly ItemScope: typeof ItemScope;
    readonly Replies: React.ForwardRefExoticComponent<CommentsRepliesProps & React.RefAttributes<HTMLDivElement>>;
    readonly Author: React.ForwardRefExoticComponent<HeadlessProps<CommentsAuthorState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLSpanElement>>;
    readonly Avatar: React.ForwardRefExoticComponent<HeadlessProps<CommentsAuthorState> & Omit<Omit<React.DetailedHTMLProps<React.ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLImageElement>>;
    readonly Content: React.ForwardRefExoticComponent<HeadlessProps<CommentsContentState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly Timestamp: React.ForwardRefExoticComponent<CommentsTimestampProps & React.RefAttributes<HTMLTimeElement>>;
    readonly LikeCount: React.ForwardRefExoticComponent<HeadlessProps<CommentsLikeCountState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLSpanElement>>;
    readonly LikeButton: React.ForwardRefExoticComponent<CommentsLikeButtonProps & React.RefAttributes<HTMLButtonElement>>;
    readonly ReplyButton: React.ForwardRefExoticComponent<CommentsReplyButtonProps & React.RefAttributes<HTMLButtonElement>>;
    readonly Labels: React.ForwardRefExoticComponent<HeadlessProps<CommentsLabelsState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLSpanElement>>;
    readonly Fallback: React.ForwardRefExoticComponent<HeadlessProps<CommentsFallbackState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly Stats: React.ForwardRefExoticComponent<HeadlessProps<CommentsStatsState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly ReplyLink: React.ForwardRefExoticComponent<HeadlessProps<CommentsReplyLinkState> & Omit<Omit<React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLAnchorElement>>;
    readonly Loading: React.ForwardRefExoticComponent<HeadlessProps<Record<string, never>> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly Error: React.ForwardRefExoticComponent<HeadlessProps<CommentsErrorState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly Empty: React.ForwardRefExoticComponent<HeadlessProps<Record<string, never>> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
};
declare const Likes: {
    readonly Root: React.ForwardRefExoticComponent<LikesRootProps & React.RefAttributes<HTMLDivElement>>;
    readonly Provider: typeof Provider;
    readonly Count: React.ForwardRefExoticComponent<HeadlessProps<LikesCountState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLSpanElement>>;
    readonly Button: React.ForwardRefExoticComponent<LikeButtonProps & React.RefAttributes<HTMLButtonElement>>;
    readonly Avatars: React.ForwardRefExoticComponent<LikesAvatarsProps & React.RefAttributes<HTMLDivElement>>;
    readonly Avatar: React.ForwardRefExoticComponent<HeadlessProps<LikeAvatarState> & Omit<Omit<React.DetailedHTMLProps<React.ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLImageElement>>;
    readonly Loading: React.ForwardRefExoticComponent<HeadlessProps<Record<string, never>> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly Empty: React.ForwardRefExoticComponent<HeadlessProps<Record<string, never>> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly Error: React.ForwardRefExoticComponent<HeadlessProps<LikesErrorState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
};
declare const Reply: {
    readonly Root: React.ForwardRefExoticComponent<ReplyRootProps & React.RefAttributes<HTMLFormElement>>;
    readonly Field: React.ForwardRefExoticComponent<HeadlessProps<ReplyFieldState> & Omit<Omit<React.DetailedHTMLProps<React.TextareaHTMLAttributes<HTMLTextAreaElement>, HTMLTextAreaElement>, "ref">, "style" | "className" | "children" | "onChange" | "value"> & React.RefAttributes<HTMLTextAreaElement>>;
    readonly Submit: React.ForwardRefExoticComponent<HeadlessProps<ReplySubmitState> & Omit<Omit<React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLButtonElement>>;
    readonly SignedIn: React.ForwardRefExoticComponent<HeadlessProps<Record<string, never>> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly SignedOut: React.ForwardRefExoticComponent<HeadlessProps<Record<string, never>> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
    readonly Error: React.ForwardRefExoticComponent<HeadlessProps<ReplyErrorState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
};
declare const Editor: {
    readonly Root: React.ForwardRefExoticComponent<EditorRootProps & React.RefAttributes<HTMLFormElement>>;
    readonly Title: React.ForwardRefExoticComponent<HeadlessProps<EditorTitleState> & Omit<Omit<React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>, "ref">, "style" | "className" | "children" | "onChange" | "value"> & React.RefAttributes<HTMLInputElement>>;
    readonly Body: React.ForwardRefExoticComponent<EditorBodyProps & React.RefAttributes<HTMLTextAreaElement>>;
    readonly Save: React.ForwardRefExoticComponent<HeadlessProps<EditorSaveState> & Omit<Omit<React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLButtonElement>>;
    readonly Status: React.ForwardRefExoticComponent<HeadlessProps<EditorStatusState> & Omit<Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref">, "style" | "className" | "children"> & React.RefAttributes<HTMLDivElement>>;
};
export { type ClassNameProp, Comments, type CommentsAuthorProps, type CommentsAuthorState, type CommentsAvatarProps, type CommentsContentProps, type CommentsContentState, type CommentsContextValue, type CommentsEmptyProps, type CommentsErrorProps, type CommentsErrorState, type CommentsFallbackProps, type CommentsFallbackState, type CommentsItemContextValue, type CommentsItemProps, type CommentsItemScopeProps, type CommentsItemState, type CommentsLabelsProps, type CommentsLabelsState, type CommentsLikeButtonProps, type CommentsLikeButtonState, type CommentsLikeCountProps, type CommentsLikeCountState, type CommentsListProps, type CommentsListState, type CommentsLoadingProps, type CommentsProviderProps, type CommentsRepliesProps, type CommentsRepliesState, type CommentsReplyButtonProps, type CommentsReplyButtonState, type CommentsReplyLinkProps, type CommentsReplyLinkState, type CommentsRootProps, type CommentsRootState, type CommentsStatsProps, type CommentsStatsState, type CommentsTimestampProps, type CommentsTimestampState, type DeliveryState, Editor, type EditorBodyProps, type EditorBodySlot, type EditorBodyState, type EditorFields, type EditorRootProps, type EditorRootState, type EditorSaveProps, type EditorSaveState, type EditorStatus, type EditorStatusProps, type EditorStatusState, type EditorTitleProps, type EditorTitleState, type HeadlessProps, type LikeAvatarProps, type LikeAvatarState, type LikeButtonProps, type LikeButtonState, Likes, type LikesAvatarsProps, type LikesAvatarsState, type LikesCountProps, type LikesCountState, type LikesEmptyProps, type LikesErrorProps, type LikesErrorState, type LikesLoadingProps, type LikesProviderProps, type LikesRootProps, type LikesRootState, type OptimisticReplyInput, type PartProps, type RenderFnProps, type RenderProp, Reply, type ReplyErrorProps, type ReplyErrorState, type ReplyFieldProps, type ReplyFieldState, type ReplyRootProps, type ReplyRootState, type ReplySession, type ReplySignedInProps, type ReplySignedOutProps, type ReplyStatus, type ReplySubmitProps, type ReplySubmitState, type RequestStatus, type StyleProp, type UseCommentsOptions, type UseCommentsReturn, type UseEditorOptions, type UseEditorReturn, type UseLikeButtonOptions, type UseLikeButtonReturn, type UseLikesOptions, type UseLikesReturn, type UseReplyOptions, type UseReplyReturn, chainHandlers, dataAttrs, mergeRefs, renderElement, useCommentItemContext, useCommentNode, useComments, useCommentsContext, useEditor, useEditorContext, useLikeButton, useLikeItemContext, useLikes, useLikesContext, useOptionalCommentItem, useReply, useReplyContext };
