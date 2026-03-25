'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  CONNECTED_ACCOUNT_PLATFORMS,
  ConnectedAccountPlatform,
  ConnectedAccountPublic,
  PlatformUploadVisibility,
} from '@/types';
import { MAX_DRAFT_TITLE_LENGTH } from '@/lib/draft-upload-metadata';
import { Progress } from '@/components/ui/progress';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Loader2, AlertCircle, Check, Upload, Film, X } from 'lucide-react';

interface DraftWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  { id: 1, title: 'Platforms' },
  { id: 2, title: 'Metadata' },
  { id: 3, title: 'Upload' },
] as const;

const PLATFORM_LABELS: Record<ConnectedAccountPlatform, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
};

const VISIBILITY_OPTIONS: Array<{ value: PlatformUploadVisibility; label: string }> = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
];

interface MetadataFormState {
  title: string;
  description: string;
  tags: string;
  visibility: Record<ConnectedAccountPlatform, PlatformUploadVisibility>;
}

interface WizardState {
  step: 1 | 2 | 3;
  selectedPlatforms: ConnectedAccountPlatform[];
  metadata: MetadataFormState;
  isDirty: boolean;
  showConfirmClose: boolean;
  savedDraftId: string | null;
}

interface ApiErrorPayload {
  error?: string;
  message?: string;
  monthlyUsage?: number;
  limit?: number;
}

const INITIAL_METADATA: MetadataFormState = {
  title: '',
  description: '',
  tags: '',
  visibility: {
    youtube: 'public',
    vimeo: 'public',
  },
};

function createInitialWizardState(): WizardState {
  return {
    step: 1,
    selectedPlatforms: [],
    metadata: { ...INITIAL_METADATA, visibility: { ...INITIAL_METADATA.visibility } },
    isDirty: false,
    showConfirmClose: false,
    savedDraftId: null,
  };
}

export function DraftWizard({ isOpen, onClose }: DraftWizardProps) {
  const router = useRouter();
  const aiPromptRef = useRef<HTMLInputElement>(null);

  // State management
  const [state, setState] = useState<WizardState>(createInitialWizardState);

  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccountPublic[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [showTitleRequiredError, setShowTitleRequiredError] = useState(false);

  // Upload state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load connected accounts on dialog open
  useEffect(() => {
    if (!isOpen) return;

    const fetchConnectedAccounts = async () => {
      try {
        setAccountsLoading(true);
        const response = await fetch('/api/platforms/connections');
        if (!response.ok) throw new Error('Failed to fetch connected accounts');
        const data = await response.json();
        setConnectedAccounts(data.data || []);
      } catch (error) {
        console.error('Error fetching connected accounts:', error);
        toast.error('Failed to load connected accounts');
      } finally {
        setAccountsLoading(false);
      }
    };

    fetchConnectedAccounts();
  }, [isOpen]);

  const clearUploadState = useCallback(() => {
    setVideoFile(null);
    setUploadProgress(0);
    setUploadComplete(false);
    setIsDraggingOver(false);
  }, []);

  const resetWizard = useCallback(() => {
    setState(createInitialWizardState());
    setShowTitleRequiredError(false);
    clearUploadState();
    if (aiPromptRef.current) {
      aiPromptRef.current.value = '';
    }
  }, [clearUploadState]);

  const getResponseErrorMessage = useCallback(async (response: Response, fallback: string) => {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;

    if (typeof payload?.message === 'string' && payload.message.trim() !== '') {
      if (typeof payload.monthlyUsage === 'number' && typeof payload.limit === 'number') {
        return `${payload.message} (${payload.monthlyUsage}/${payload.limit} used)`;
      }

      return payload.message;
    }

    if (typeof payload?.error === 'string' && payload.error.trim() !== '') {
      return payload.error;
    }

    return fallback;
  }, []);

  const ensureTitlePresent = useCallback(() => {
    const hasTitle = state.metadata.title.trim() !== '';
    setShowTitleRequiredError(!hasTitle);

    if (!hasTitle) {
      toast.error('Title is required');
    }

    return hasTitle;
  }, [state.metadata.title]);

  const handlePlatformToggle = (platform: ConnectedAccountPlatform) => {
    setState((prev) => ({
      ...prev,
      selectedPlatforms: prev.selectedPlatforms.includes(platform)
        ? prev.selectedPlatforms.filter((p) => p !== platform)
        : [...prev.selectedPlatforms, platform],
      isDirty: true,
    }));
  };

  const handleMetadataChange = (field: keyof Omit<MetadataFormState, 'visibility'>) => {
    return (value: string) => {
      if (field === 'title' && value.trim() !== '') {
        setShowTitleRequiredError(false);
      }

      setState((prev) => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          [field]: value,
        },
        isDirty: true,
      }));
    };
  };

  const handleVisibilityChange = (platform: ConnectedAccountPlatform, value: string) => {
    setState((prev) => ({
      ...prev,
      metadata: {
        ...prev.metadata,
        visibility: {
          ...prev.metadata.visibility,
          [platform]: value as PlatformUploadVisibility,
        },
      },
      isDirty: true,
    }));
  };

  const generateMetadata = useCallback(
    async (prompt: string) => {
      if (state.selectedPlatforms.length === 0) {
        toast.error('Please select at least one platform first');
        return;
      }

      try {
        setAiLoading(true);
        const response = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            platforms: state.selectedPlatforms,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to generate metadata');
        }

        const data = await response.json();
        const { title, description, tags } = data.data;

        setState((prev) => ({
          ...prev,
          metadata: {
            ...prev.metadata,
            title: title || '',
            description: description || '',
            tags: tags?.join(', ') || '',
          },
          isDirty: true,
        }));

        toast.success('Metadata generated successfully');
      } catch (error) {
        console.error('Error generating metadata:', error);
        toast.error('Failed to generate metadata. Please try again.');
      } finally {
        setAiLoading(false);
      }
    },
    [state.selectedPlatforms]
  );

  const handleGoToStep2 = () => {
    if (state.selectedPlatforms.length === 0) {
      toast.error('Please select at least one platform');
      return;
    }
    setState((prev) => ({ ...prev, step: 2 }));
  };

  const handleBackToStep1 = () => {
    setState((prev) => ({ ...prev, step: 1 }));
  };

  const handleBackToStep2 = () => {
    clearUploadState();
    setState((prev) => ({ ...prev, step: 2 }));
  };

  /** Navigate to a specific step with validation. */
  const handleStepNavigation = (targetStep: 1 | 2 | 3) => {
    if (targetStep === state.step) return; // Already on this step

    // Validate backward navigation (always allowed)
    if (targetStep < state.step) {
      if (targetStep === 2) {
        setState((prev) => ({ ...prev, step: 2 }));
      } else if (targetStep === 1) {
        setState((prev) => ({ ...prev, step: 1 }));
        clearUploadState();
      }
      return;
    }

    // Validate forward navigation
    if (targetStep === 2 && state.step === 1) {
      if (state.selectedPlatforms.length === 0) {
        toast.error('Please select at least one platform');
        return;
      }
      setState((prev) => ({ ...prev, step: 2 }));
    } else if (targetStep === 3 && state.step === 2) {
      if (!ensureTitlePresent()) {
        return;
      }
      // Navigate to step 3 without saving
      handleAdvanceToStep3();
    }
  };

  /** Navigate to step 3 without saving. */
  const handleAdvanceToStep3 = () => {
    if (!ensureTitlePresent()) {
      return;
    }
    setState((prev) => ({ ...prev, step: 3 }));
  };

  const ALLOWED_VIDEO_TYPES = [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/webm',
  ];
  const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

  const validateVideoFile = (file: File): string | null => {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_VIDEO_TYPES.includes(file.type) || !ALLOWED_VIDEO_EXTENSIONS.includes(ext)) {
      return 'Unsupported format. Accepted: MP4, MOV, AVI, MKV, WebM';
    }
    if (file.size > 5 * 1024 * 1024 * 1024) {
      return 'File exceeds the 5 GB maximum size';
    }
    return null;
  };

  const handleFileSelect = (file: File) => {
    const error = validateVideoFile(file);
    if (error) {
      toast.error(error);
      return;
    }

    setState((prev) => ({ ...prev, isDirty: true }));
    setVideoFile(file);
    setUploadProgress(0);
    setUploadComplete(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleUploadVideo = async () => {
    if (!videoFile) return;

    try {
      setUploading(true);
      setUploadProgress(0);

      // If draft hasn't been saved yet, save it first
      let draftId = state.savedDraftId;
      if (!draftId) {
        const tagsArray = state.metadata.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);

        const platformsData: Record<string, object> = {};
        state.selectedPlatforms.forEach((platform) => {
          platformsData[platform] = { visibility: state.metadata.visibility[platform] };
        });

        const saveDraftRes = await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: state.metadata.title,
            description: state.metadata.description,
            tags: tagsArray,
            targets: state.selectedPlatforms,
            visibility: state.metadata.visibility[state.selectedPlatforms[0]],
            platforms: platformsData,
          }),
        });

        if (!saveDraftRes.ok) {
          throw new Error(await getResponseErrorMessage(saveDraftRes, 'Failed to save draft'));
        }

        const saveDraftData = await saveDraftRes.json();
        draftId = saveDraftData.data.id;
        setState((prev) => ({ ...prev, savedDraftId: draftId, isDirty: false }));
      }

      // Step 1: get presigned URL
      const presignRes = await fetch('/api/uploads/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: videoFile.name,
          contentType: videoFile.type,
          fileSize: videoFile.size,
          draftId: draftId,
        }),
      });

      if (!presignRes.ok) {
        throw new Error(await getResponseErrorMessage(presignRes, 'Failed to get upload URL'));
      }

      const { uploadUrl, uploadJobId } = (await presignRes.json()) as {
        uploadUrl: string;
        uploadJobId: string;
        key: string;
      };

      // Step 2: PUT directly to R2 with progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', videoFile.type);

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed — network error')));
        xhr.send(videoFile);
      });

      setUploadProgress(100);

      // Step 3: notify server that upload is complete
      const completeRes = await fetch(`/api/uploads/${uploadJobId}/complete`, {
        method: 'POST',
      });

      if (!completeRes.ok) {
        throw new Error(await getResponseErrorMessage(completeRes, 'Failed to confirm upload'));
      }

      setUploadComplete(true);
      toast.success('Video uploaded successfully!');

      // Reset wizard state and navigate to the draft
      resetWizard();
      onClose();
      router.push(`/dashboard/drafts/${draftId}`);
    } catch (error) {
      console.error('Upload error:', error);
      setUploadProgress(0);
      setUploadComplete(false);
      toast.error(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!ensureTitlePresent()) {
      return;
    }

    try {
      setSavingDraft(true);

      const tagsArray = state.metadata.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      const platformsData: Record<string, object> = {};
      state.selectedPlatforms.forEach((platform) => {
        platformsData[platform] = { visibility: state.metadata.visibility[platform] };
      });

      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: state.metadata.title,
          description: state.metadata.description,
          tags: tagsArray,
          targets: state.selectedPlatforms,
          ...(state.selectedPlatforms.length > 0 && {
            visibility: state.metadata.visibility[state.selectedPlatforms[0]],
          }),
          platforms: platformsData,
        }),
      });

      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, 'Failed to save draft'));
      }

      const data = await response.json();
      const draftId = data.data.id;

      toast.success('Draft saved');

      resetWizard();

      onClose();
      router.push(`/dashboard/drafts/${draftId}`);
    } catch (error) {
      console.error('Error saving draft:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to save draft. Please try again.'
      );
    } finally {
      setSavingDraft(false);
    }
  };

  const handleClose = () => {
    if (state.isDirty) {
      setState((prev) => ({ ...prev, showConfirmClose: true }));
    } else {
      onClose();
    }
  };

  const handleConfirmClose = () => {
    resetWizard();
    onClose();
  };

  const connectedPlatforms = connectedAccounts.map((acc) => acc.platform);
  const titleCharCount = state.metadata.title.length;
  const isTitleOverLimit =
    state.selectedPlatforms.length > 0 && titleCharCount > MAX_DRAFT_TITLE_LENGTH;
  const hasGeneratedMetadata =
    state.metadata.title.trim() !== '' ||
    state.metadata.description.trim() !== '' ||
    state.metadata.tags.trim() !== '';
  const showTitleError = showTitleRequiredError && state.metadata.title.trim() === '';

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleClose();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Draft</DialogTitle>
            {/* Step Navigation using Breadcrumb */}
            <Breadcrumb>
              <BreadcrumbList>
                {STEPS.map((step, idx) => (
                  <div key={step.id} className="flex items-center gap-0">
                    <BreadcrumbItem>
                      {state.step === step.id ? (
                        <BreadcrumbPage className="font-bold">{step.title}</BreadcrumbPage>
                      ) : (
                        <button
                          onClick={() => handleStepNavigation(step.id as 1 | 2 | 3)}
                          disabled={uploading}
                          className={`hover:underline ${
                            uploading
                              ? 'cursor-not-allowed opacity-50 pointer-events-none'
                              : 'cursor-pointer'
                          }`}
                        >
                          {step.title}
                        </button>
                      )}
                    </BreadcrumbItem>
                    {idx < STEPS.length - 1 && <BreadcrumbSeparator />}
                  </div>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
            <DialogDescription asChild className="pt-2">
              <span className="text-xs text-muted-foreground">
                Step {state.step} of {STEPS.length}
              </span>
            </DialogDescription>
          </DialogHeader>

          {/* Step 1: Platform Selection */}
          {state.step === 1 && (
            <div className="space-y-6 py-4">
              <div>
                <h3 className="text-lg font-semibold mb-4">Select Target Platforms</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Choose which platforms you want to distribute this video to.
                </p>

                {accountsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {CONNECTED_ACCOUNT_PLATFORMS.map((platform) => {
                      const account = connectedAccounts.find((acc) => acc.platform === platform);
                      const isConnected = !!account;
                      const isSelected = state.selectedPlatforms.includes(platform);

                      return (
                        <Card
                          key={platform}
                          role="button"
                          tabIndex={isConnected ? 0 : -1}
                          aria-pressed={isConnected ? isSelected : undefined}
                          aria-disabled={!isConnected}
                          className={`p-4 transition-all ${
                            isConnected
                              ? isSelected
                                ? 'cursor-pointer ring-2 ring-blue-500 bg-blue-50'
                                : 'cursor-pointer hover:shadow-md'
                              : 'opacity-70'
                          }`}
                          onClick={() => {
                            if (isConnected) {
                              handlePlatformToggle(platform);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (isConnected && (e.key === 'Enter' || e.key === ' ')) {
                              e.preventDefault();
                              handlePlatformToggle(platform);
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 ${
                                  isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                                }`}
                              >
                                {isSelected && <Check className="h-4 w-4 text-white" />}
                              </div>
                              <div>
                                <p className="font-semibold">{PLATFORM_LABELS[platform]}</p>
                                {isConnected ? (
                                  <p className="text-sm text-muted-foreground">
                                    {account.platformName}
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-xs text-amber-600">
                                      Not connected. Connect this platform before using it.
                                    </p>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        router.push('/profile/connections');
                                      }}
                                    >
                                      Connect
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                            {isConnected && (
                              <Badge className="text-xs shrink-0 bg-green-100 text-green-700 hover:bg-green-100">
                                Connected
                              </Badge>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              {state.selectedPlatforms.length === 0 && !accountsLoading && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <p className="text-sm text-amber-700">Select at least one platform to continue</p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Metadata & AI Generation */}
          {state.step === 2 && (
            <div className="space-y-6 py-4">
              {/* Selected Platforms Display */}
              <div>
                <p className="text-sm font-medium text-gray-600 mb-2">Target Platforms</p>
                <div className="flex gap-2">
                  {state.selectedPlatforms.map((platform) => (
                    <Badge key={platform} variant="secondary">
                      {PLATFORM_LABELS[platform]}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* AI Prompt Section */}
              <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div>
                  <Label htmlFor="ai-prompt" className="text-sm font-medium">
                    AI Prompt (Optional)
                  </Label>
                  <p className="text-xs text-gray-600 mt-1">
                    Describe your video briefly to generate metadata
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    id="ai-prompt"
                    ref={aiPromptRef}
                    placeholder="e.g., 'A tutorial on making coffee with espresso machine'"
                    className="flex-1"
                    disabled={aiLoading}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !aiLoading) {
                        generateMetadata(aiPromptRef.current?.value ?? '');
                      }
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => generateMetadata(aiPromptRef.current?.value ?? '')}
                    disabled={aiLoading}
                    className="whitespace-nowrap"
                  >
                    {aiLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      `${hasGeneratedMetadata ? 'Regenerate' : 'Generate'} with AI`
                    )}
                  </Button>
                </div>
              </div>

              {/* Metadata Form Fields */}
              <div className="space-y-4">
                {/* Title */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label htmlFor="title">Title *</Label>
                    <span
                      className={`text-xs ${
                        isTitleOverLimit ? 'text-red-600 font-semibold' : 'text-gray-500'
                      }`}
                    >
                      {titleCharCount}/{MAX_DRAFT_TITLE_LENGTH}
                    </span>
                  </div>
                  <Input
                    id="title"
                    placeholder="Enter video title"
                    value={state.metadata.title}
                    onChange={(e) => handleMetadataChange('title')(e.target.value)}
                    maxLength={MAX_DRAFT_TITLE_LENGTH}
                    className={isTitleOverLimit || showTitleError ? 'border-red-500' : ''}
                  />
                  {showTitleError && <p className="text-xs text-red-600">Title is required</p>}
                  {isTitleOverLimit && (
                    <p className="text-xs text-red-600">
                      Title exceeds the {MAX_DRAFT_TITLE_LENGTH} character limit
                    </p>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Enter video description"
                    value={state.metadata.description}
                    onChange={(e) => handleMetadataChange('description')(e.target.value)}
                    rows={4}
                    maxLength={5000}
                  />
                  <p className="text-xs text-gray-500">{state.metadata.description.length}/5000</p>
                </div>

                {/* Tags */}
                <div className="space-y-2">
                  <Label htmlFor="tags">Tags</Label>
                  <Input
                    id="tags"
                    placeholder="Enter tags separated by commas (e.g., tutorial, coffee, espresso)"
                    value={state.metadata.tags}
                    onChange={(e) => handleMetadataChange('tags')(e.target.value)}
                  />
                  <p className="text-xs text-gray-500">
                    {state.metadata.tags.split(',').filter((t) => t.trim()).length} tags
                  </p>
                </div>
              </div>

              {/* Per-Platform Visibility */}
              <div className="space-y-4">
                <h4 className="font-medium">Visibility Settings</h4>
                {state.selectedPlatforms.map((platform) => (
                  <div key={platform} className="flex items-end gap-3">
                    <div className="flex-1">
                      <Label htmlFor={`visibility-${platform}`} className="text-sm">
                        {PLATFORM_LABELS[platform]}
                      </Label>
                    </div>
                    <Select
                      value={state.metadata.visibility[platform]}
                      onValueChange={(value) => handleVisibilityChange(platform, value)}
                    >
                      <SelectTrigger id={`visibility-${platform}`} className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VISIBILITY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Upload Video */}
          {state.step === 3 && (
            <div className="space-y-6 py-4">
              <div>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload your video file directly to secure cloud storage. Accepted formats: MP4,
                  MOV, AVI, MKV, WebM — up to 5 GB.
                </p>

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.avi,.mkv,.webm"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                    e.target.value = '';
                  }}
                />

                {!videoFile ? (
                  /* Drag-and-drop zone */
                  <div
                    role="button"
                    tabIndex={0}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                    }}
                    className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center cursor-pointer transition-colors ${
                      isDraggingOver
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-border bg-muted/40 hover:border-blue-300 hover:bg-muted/60'
                    }`}
                  >
                    <Film
                      className={`h-12 w-12 mb-4 ${isDraggingOver ? 'text-blue-500' : 'text-muted-foreground'}`}
                    />
                    <p className="text-sm font-medium mb-1">
                      {isDraggingOver ? 'Drop your video here' : 'Drag & drop your video here'}
                    </p>
                    <p className="text-xs text-muted-foreground mb-4">or</p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      Select Video File
                    </Button>
                    <p className="text-xs text-muted-foreground mt-4">
                      MP4, MOV, AVI, MKV, WebM &mdash; max 5 GB
                    </p>
                  </div>
                ) : (
                  /* Selected file info */
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
                      <Film className="h-8 w-8 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{videoFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(videoFile.size)}
                        </p>
                      </div>
                      {!uploading && !uploadComplete && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={() => setVideoFile(null)}
                          aria-label="Remove selected file"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* Progress bar */}
                    {(uploading || uploadComplete) && (
                      <div className="space-y-1">
                        <Progress value={uploadProgress} className="h-2" />
                        <p className="text-xs text-muted-foreground text-right">
                          {uploadComplete ? 'Upload complete!' : `${uploadProgress}% uploaded`}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Dialog Footer with Navigation */}
          <DialogFooter className="flex justify-between pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={
                state.step === 2
                  ? handleBackToStep1
                  : state.step === 3
                    ? handleBackToStep2
                    : handleClose
              }
              disabled={uploading}
            >
              {state.step === 1 ? 'Cancel' : 'Back'}
            </Button>

            <div className="flex gap-2">
              {state.step === 1 && (
                <Button
                  onClick={handleGoToStep2}
                  disabled={state.selectedPlatforms.length === 0 || accountsLoading}
                >
                  Next
                </Button>
              )}

              {state.step === 2 && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleSaveDraft} disabled={savingDraft}>
                    {savingDraft ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Draft'
                    )}
                  </Button>
                  <Button onClick={handleAdvanceToStep3}>
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Next: Upload Video
                    </>
                  </Button>
                </div>
              )}

              {state.step === 3 && (
                <Button
                  onClick={handleUploadVideo}
                  disabled={!videoFile || uploading || uploadComplete}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Uploading {uploadProgress}%
                    </>
                  ) : uploadComplete ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Uploaded!
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Video
                    </>
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Unsaved Changes */}
      <AlertDialog
        open={state.showConfirmClose}
        onOpenChange={(open) => {
          if (!open) {
            setState((prev) => ({ ...prev, showConfirmClose: false }));
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to close without saving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose} className="bg-red-600">
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
