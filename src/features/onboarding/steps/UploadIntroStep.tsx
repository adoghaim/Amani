import { Upload } from 'lucide-react';
import { Button } from '../../../components/Button';

interface UploadIntroStepProps {
  onUpload: () => void;
  onSkip: () => void;
  isSubmitting: boolean;
}

export function UploadIntroStep({ onUpload, onSkip, isSubmitting }: UploadIntroStepProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-16 h-16 rounded-2xl bg-theme-surface-2 flex items-center justify-center mb-6">
        <Upload className="w-8 h-8 text-theme-primary" />
      </div>
      <h1 className="text-2xl sm:text-3xl text-theme-text mb-3">
        Upload your first lab report
      </h1>
      <p className="text-base text-theme-muted-text leading-relaxed mb-8 max-w-sm">
        You can upload a PDF, screenshot, or photo of your lab results. Amani will extract the markers, explain what they mean, and prepare questions you could bring to your clinician.
      </p>

      <Button
        variant="primary"
        size="lg"
        className="w-full mb-3"
        onClick={onUpload}
        disabled={isSubmitting}
        loading={isSubmitting}
      >
        {isSubmitting ? 'Saving...' : 'Upload Lab Report'}
      </Button>

      <button
        type="button"
        onClick={onSkip}
        disabled={isSubmitting}
        className="text-sm font-medium text-theme-muted-text hover:text-theme-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed py-2"
      >
        Skip for now
      </button>
    </div>
  );
}
