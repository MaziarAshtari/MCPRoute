import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@mcproute/shared';
import { CircleAlert, Eye, EyeOff, Route } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/api';
import { useLogin, useMe } from '@/queries/auth';

/** Only same-origin paths are accepted as redirect targets. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) return '/';
  return value;
}

export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' } });

  if (me.data) return <Navigate to={next} replace />;

  async function onSubmit(values: LoginInput) {
    try {
      const session = await login.mutateAsync(values);
      toast.success(`Signed in as ${session.username}`);
      navigate(next, { replace: true });
    } catch (error) {
      const message = errorMessage(error);
      setError('root', { message });
      toast.error('Sign-in failed', { description: message });
    }
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="flex items-center gap-2 text-lg font-semibold">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Route className="size-4" />
        </div>
        MCPRoute
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>Use the admin credentials from your MCPRoute configuration.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              {errors.root?.message && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{errors.root.message}</AlertDescription>
                </Alert>
              )}
              <Field data-invalid={!!errors.username}>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input
                  id="username"
                  autoComplete="username"
                  autoFocus
                  aria-invalid={!!errors.username}
                  {...register('username')}
                />
                <FieldError errors={[errors.username]} />
              </Field>
              <Field data-invalid={!!errors.password}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    aria-invalid={!!errors.password}
                    {...register('password')}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldError errors={[errors.password]} />
              </Field>
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting && <Spinner data-icon="inline-start" />}
                Sign in
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
