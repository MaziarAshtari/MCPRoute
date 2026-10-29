import type { EndpointDto } from '@mcproute/shared';
import { TriangleAlert } from 'lucide-react';
import { CopyButton } from '@/components/copy';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ConnectPanel } from './connect-panel';

export interface IssuedToken {
  endpoint: EndpointDto;
  token: string;
}

interface TokenDialogProps {
  issued: IssuedToken | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Shows a freshly issued access token. It cannot be retrieved again, so closing requires the button. */
export function TokenDialog({ issued, open, onOpenChange }: TokenDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Access token for {issued?.endpoint.name}</DialogTitle>
          <DialogDescription>MCP clients authenticate to this endpoint with this token.</DialogDescription>
        </DialogHeader>
        {issued && (
          <div className="min-w-0 space-y-4">
            <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100">
              <TriangleAlert />
              <AlertTitle>Copy the token now</AlertTitle>
              <AlertDescription className="text-amber-900/80 dark:text-amber-100/80">
                This is the only time it is shown. If you lose it, regenerate the token; the old one then stops working.
              </AlertDescription>
            </Alert>
            <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
              <code className="min-w-0 flex-1 font-mono text-sm break-all" data-testid="access-token">
                {issued.token}
              </code>
              <CopyButton value={issued.token} label="Access token" variant="default">
                Copy
              </CopyButton>
            </div>
            <Separator />
            <ConnectPanel endpoint={issued.endpoint} token={issued.token} />
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>I have saved the token</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
