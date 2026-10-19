import React, {useState} from 'react';
import {Image, Pressable, View} from 'react-native';
import {launchCamera, launchImageLibrary, type Asset} from 'react-native-image-picker';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import {Camera, Check, ImagePlus, ScanLine} from 'lucide-react-native';
import {api, ApiError, uploadFile} from '../../api/client';
import {useMeQuery, useUpdateMeMutation} from '../../api/endpoints';
import type {ExpensePayload, ItemPayload} from '../../api/types';
import {
  Banner,
  Button,
  Card,
  DishVisual,
  Footer,
  Header,
  LoadingState,
  Screen,
  SectionTitle,
  SwitchRow,
  Text,
  radius,
  space,
  useTheme,
  useToast,
} from '../../design';
import {formatBp, formatMoney, formatQty} from '../../money/currency';
import type {AppScreen} from '../../navigation/types';
import {useAppDispatch, useAppSelector} from '../../store';
import {draftActions, matchReceiptPatch, newCharge, newDiscount, newItem, preview} from '../expenses/draft';

interface Parsed {
  merchant: string | null;
  date: string | null;
  items: Array<{name: string; quantity_milli: number; unit_price_minor: number; amount_minor: number; confidence: number; source: string}>;
  taxes: Array<{component: 'GST' | 'CGST' | 'SGST' | 'IGST'; rate_bp: number | null; amount_minor: number; source: string}>;
  charges: Array<{label: string; amount_minor: number; rate_bp: number | null; source: string}>;
  discounts: Array<{label: string; amount_minor: number; rate_bp: number | null; source: string}>;
  subtotal_minor: number | null;
  round_off_minor: number | null;
  total_minor: number | null;
  warnings: string[];
}

type Stage = 'pick' | 'reading' | 'review' | 'failed';

export function ReceiptScanScreen({route, navigation}: AppScreen<'ReceiptScan'>) {
  const {localId} = route.params;
  const dispatch = useAppDispatch();
  const toast = useToast();
  const {colors} = useTheme();
  const draft = useAppSelector(s => s.drafts.byId[localId]);
  const me = useMeQuery();
  const [updateMe] = useUpdateMeMutation();
  const [stage, setStage] = useState<Stage>('pick');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [useTaxes, setUseTaxes] = useState(true);
  const [useExtras, setUseExtras] = useState(true);
  const [attachPhoto, setAttachPhoto] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const consented = me.data?.preferences?.receipt_processing_consent === true;
  const currency = draft?.payload.currency ?? 'INR';

  const read = async (a: Asset) => {
    setAsset(a);
    setStage('reading');
    setFailure(null);
    let result: Awaited<ReturnType<typeof TextRecognition.recognize>>;
    try {
      result = await TextRecognition.recognize(a.uri!);
    } catch {
      setFailure("This photo couldn't be read on this phone. Try another photo, or add the items by hand.");
      setStage('failed');
      return;
    }
    try {
      const lines = result.blocks.flatMap(b =>
        b.lines.map(l => ({
          text: l.text,
          left: l.frame?.left ?? 0,
          top: l.frame?.top ?? 0,
          width: l.frame?.width ?? 0,
          height: l.frame?.height ?? 0,
        })),
      );
      if (!lines.length) {
        setFailure('No text was found in that photo. Try a sharper, well-lit photo, or add the items by hand.');
        setStage('failed');
        return;
      }
      const body = {lines: lines.slice(0, 600), currency, provider: 'mlkit-on-device'};
      // The free server can answer with an error page while it wakes up: try once more.
      const p = await api.post<Parsed>('/receipts/parse', body).catch(() => api.post<Parsed>('/receipts/parse', body));
      setParsed(p);
      setSelected(p.items.map(() => true));
      const comps = new Set(p.taxes.map(t => t.component));
      setUseTaxes(p.taxes.length > 0 && p.taxes.every(t => t.rate_bp) && comps.has('CGST') === comps.has('SGST'));
      setStage('review');
    } catch (e) {
      setFailure(
        e instanceof ApiError
          ? e.message
          : "The bill was read, but SplitMate's server didn't answer properly. Wait a few seconds and try again.",
      );
      setStage('failed');
    }
  };

  const pick = async (camera: boolean) => {
    const opts = {mediaType: 'photo' as const, quality: 0.8 as const, maxWidth: 2000, maxHeight: 2000, saveToPhotos: false};
    const res = camera ? await launchCamera(opts) : await launchImageLibrary({...opts, selectionLimit: 1});
    if (res.didCancel) {
      return;
    }
    if (res.errorCode || !res.assets?.[0]?.uri) {
      setFailure(res.errorCode === 'camera_unavailable' ? 'No camera is available. Choose a photo instead.' : "That photo couldn't be opened.");
      setStage('failed');
      return;
    }
    read(res.assets[0]);
  };

  // Tax lines as printed. A pair of CGST+SGST at r% each means items are taxed at 2r%.
  const taxPlan = (() => {
    if (!parsed || !parsed.taxes.length) {
      return null;
    }
    const cg = parsed.taxes.find(t => t.component === 'CGST');
    const sg = parsed.taxes.find(t => t.component === 'SGST');
    const ig = parsed.taxes.find(t => t.component === 'IGST');
    const g = parsed.taxes.find(t => t.component === 'GST');
    if (cg && sg && cg.rate_bp && sg.rate_bp && cg.rate_bp === sg.rate_bp && parsed.taxes.length === 2) {
      return {scheme: 'cgst_sgst' as const, rate: cg.rate_bp * 2, reported: [cg, sg]};
    }
    if (ig && ig.rate_bp && parsed.taxes.length === 1) {
      return {scheme: 'igst' as const, rate: ig.rate_bp, reported: [ig]};
    }
    if (g && g.rate_bp && parsed.taxes.length === 1) {
      return {scheme: 'gst' as const, rate: g.rate_bp, reported: [g]};
    }
    return null; // several rates or missing rates: the person sets item tax by hand
  })();

  const apply = async () => {
    if (!draft || !parsed) {
      return;
    }
    setSaving(true);
    let receiptId = draft.payload.receipt_id;
    if (attachPhoto && asset?.uri) {
      try {
        const up = await uploadFile<{id: string}>(`/groups/${draft.groupId}/receipts`, {
          uri: asset.uri,
          type: asset.type ?? 'image/jpeg',
          name: asset.fileName ?? 'receipt.jpg',
        });
        receiptId = up.id;
      } catch (e) {
        toast(e instanceof ApiError ? `Photo not attached: ${e.message}` : 'Photo not attached', 'negative');
      }
    }
    const applyTax = useTaxes && taxPlan;
    const items: ItemPayload[] = parsed.items
      .filter((_, i) => selected[i])
      .map(it =>
        newItem({
          name: it.name,
          quantity_milli: it.quantity_milli,
          unit_price_minor: it.unit_price_minor,
          source: 'receipt',
          ocr_confidence: it.confidence,
          tax_rate_bp: applyTax ? taxPlan.rate : 0,
          tax_scheme: applyTax ? taxPlan.scheme : 'gst',
          tax_inclusive: false,
        }),
      );
    const p = draft.payload;
    const next: Partial<ExpensePayload> = {
          title: p.title || parsed.merchant || p.title,
          expense_date: parsed.date ?? p.expense_date,
          items: [...p.items, ...items],
          receipt_id: receiptId,
          receipt_total_minor: parsed.total_minor ?? p.receipt_total_minor,
          reported_taxes: applyTax
            ? taxPlan.reported.map(t => ({component: t.component, rate_bp: t.rate_bp!, amount_minor: t.amount_minor}))
            : p.reported_taxes,
          discounts: useExtras
            ? [...p.discounts, ...parsed.discounts.map(d => newDiscount({label: d.label || 'Discount', kind: 'fixed', value: d.amount_minor}))]
            : p.discounts,
          charges: useExtras
            ? [
                ...p.charges,
                ...parsed.charges.map(c =>
                  newCharge({
                    type: (['service', 'packaging', 'delivery', 'tip'].includes(c.label) ? c.label : 'other') as any,
                    label: c.label === 'service' ? 'Service charge' : c.label[0].toUpperCase() + c.label.slice(1),
                    kind: 'fixed',
                    value: c.amount_minor,
                    tax_rate_bp: applyTax && c.label === 'service' ? taxPlan.rate : 0,
                    tax_scheme: applyTax ? taxPlan.scheme : 'gst',
                  }),
                ),
              ]
            : p.charges,
          rounding: useExtras && parsed.round_off_minor ? {mode: 'explicit', amount_minor: parsed.round_off_minor} : p.rounding,
    };
    // A small gap to the printed total is the restaurant's rounding or untaxed items (water
    // bottles, packed goods): share it out straight away. A big gap usually means a misread
    // price, so leave that for the person to check on the review screen.
    const merged = {...p, ...next} as ExpensePayload;
    const fix = matchReceiptPatch(merged);
    const gap = merged.receipt_total_minor ? Math.abs(preview(merged).result.total - merged.receipt_total_minor) : 0;
    const autoMatched = !!fix && gap > 0 && gap <= Math.max(500, Math.round((merged.receipt_total_minor ?? 0) * 0.02));
    dispatch(draftActions.patch({localId, payload: autoMatched ? {...next, ...fix} : next}));
    setSaving(false);
    toast(
      `${items.length} item${items.length === 1 ? '' : 's'} added from the receipt${
        autoMatched ? ` · the ${formatMoney(gap, currency)} difference to the printed total is shared by everyone` : ''
      } · please check them`,
      'positive',
    );
    navigation.goBack();
  };

  if (!draft) {
    return (
      <Screen header={<Header title="Scan receipt" />}>
        <Banner tone="warning" title="This draft isn't on this phone any more." />
      </Screen>
    );
  }

  if (!consented) {
    return (
      <Screen header={<Header title="Scan receipt" />}>
        <Card style={{gap: space.md}}>
          <ScanLine size={32} color={colors.food} />
          <Text variant="heading">Before you scan</Text>
          <Text variant="body" tone="muted">
            The text on your receipt is read on this phone. The recognised text (not the photo) is sent to SplitMate to sort it into items, taxes and totals. Nothing is saved unless you add it to a bill.
          </Text>
          <Text variant="body" tone="muted">
            If you also attach the photo to the expense, it's stored privately and only people in this group can see it.
          </Text>
          <Text variant="body" tone="muted">
            Scanning is optional. You can always type the items yourself.
          </Text>
          <Button
            label="OK, scan receipts"
            onPress={() => updateMe({preferences: {receipt_processing_consent: true}})}
          />
          <Button label="Type items instead" variant="ghost" onPress={() => navigation.goBack()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header title="Scan receipt" subtitle={stage === 'review' ? 'Check what was read' : undefined} />}
      footer={
        stage === 'review' && parsed ? (
          <Footer>
            <Button
              label={`Add ${selected.filter(Boolean).length} item${selected.filter(Boolean).length === 1 ? '' : 's'} to the bill`}
              icon={Check}
              size="lg"
              variant="food"
              loading={saving}
              disabled={!selected.some(Boolean)}
              onPress={apply}
              testID="receipt-apply"
            />
          </Footer>
        ) : undefined
      }>
      {stage === 'pick' || stage === 'failed' ? (
        <>
          {failure ? <Banner tone="warning" title={failure} /> : null}
          <Card style={{alignItems: 'center', paddingVertical: space.xxl, marginTop: space.md}}>
            <Text style={{fontSize: 46}}>🧾</Text>
            <Text variant="heading" style={{marginTop: space.md}}>
              Photograph the whole bill
            </Text>
            <Text variant="small" tone="muted" align="center" style={{marginTop: space.xs, maxWidth: 280}}>
              Flat, well lit and in focus works best. You'll check every line before anything is added.
            </Text>
            <View style={{flexDirection: 'row', gap: space.sm, marginTop: space.xl, alignSelf: 'stretch'}}>
              <Button label="Take photo" icon={Camera} style={{flex: 1}} onPress={() => pick(true)} />
              <Button label="Choose photo" icon={ImagePlus} variant="secondary" style={{flex: 1}} onPress={() => pick(false)} />
            </View>
          </Card>
          <Button label="Type the items instead" variant="ghost" onPress={() => navigation.goBack()} style={{marginTop: space.md}} />
        </>
      ) : null}

      {stage === 'reading' ? (
        <>
          {asset?.uri ? <Image source={{uri: asset.uri}} style={{height: 220, borderRadius: radius.lg, opacity: 0.5}} resizeMode="cover" /> : null}
          <LoadingState label="Reading the receipt on your phone…" />
        </>
      ) : null}

      {stage === 'review' && parsed ? (
        <>
          {parsed.warnings.map(w => (
            <View key={w} style={{marginBottom: space.sm}}>
              <Banner tone="warning" title={w} />
            </View>
          ))}
          {parsed.merchant || parsed.date ? (
            <Text variant="small" tone="muted">
              {[parsed.merchant, parsed.date].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          <SectionTitle title={`Items read · ${parsed.items.length}`} />
          <Card padded={false} style={{paddingHorizontal: space.sm}}>
            {parsed.items.map((it, i) => (
              <Pressable
                key={i}
                accessibilityRole="checkbox"
                accessibilityState={{checked: selected[i]}}
                onPress={() => setSelected(selected.map((s, j) => (j === i ? !s : s)))}
                style={{flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, opacity: selected[i] ? 1 : 0.45}}>
                <DishVisual name={it.name} size={40} rounded={12} />
                <View style={{flex: 1}}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {it.name}
                  </Text>
                  <Text variant="caption" tone={it.confidence < 70 ? 'warning' : 'faint'} numberOfLines={1}>
                    {formatQty(it.quantity_milli)} × {formatMoney(it.unit_price_minor, currency)}
                    {it.confidence < 70 ? ' · check this line' : ''} · “{it.source}”
                  </Text>
                </View>
                <Text variant="amountSmall">{formatMoney(it.amount_minor, currency)}</Text>
                <View style={{width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.accent, backgroundColor: selected[i] ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center'}}>
                  {selected[i] ? <Check size={14} color="#fff" /> : null}
                </View>
              </Pressable>
            ))}
          </Card>
          {parsed.subtotal_minor !== null ? (
            <Text variant="small" tone={parsed.items.filter((_, i) => selected[i]).reduce((a, x) => a + x.amount_minor, 0) === parsed.subtotal_minor ? 'positive' : 'warning'} style={{marginTop: space.xs}}>
              Selected items {formatMoney(parsed.items.filter((_, i) => selected[i]).reduce((a, x) => a + x.amount_minor, 0), currency)} · receipt subtotal {formatMoney(parsed.subtotal_minor, currency)}
            </Text>
          ) : null}

          <SectionTitle title="Tax, charges and total" />
          <Card>
            {parsed.taxes.map((t, i) => (
              <Text key={i} variant="small" tone="muted">
                {t.component} {t.rate_bp ? formatBp(t.rate_bp) : '(no rate printed)'} · {formatMoney(t.amount_minor, currency)}
              </Text>
            ))}
            {parsed.taxes.length ? (
              taxPlan ? (
                <SwitchRow
                  title={`Use the receipt's tax (${taxPlan.scheme === 'cgst_sgst' ? 'CGST+SGST' : taxPlan.scheme.toUpperCase()} ${formatBp(taxPlan.rate)})`}
                  subtitle="Sets this rate on the scanned items and uses the printed tax amounts."
                  value={useTaxes}
                  onChange={setUseTaxes}
                />
              ) : (
                <Text variant="small" tone="warning" style={{marginTop: space.xs}}>
                  The tax lines don't match one clear rate. Set each item's tax yourself after adding them.
                </Text>
              )
            ) : (
              <Text variant="small" tone="muted">
                No tax lines were read.
              </Text>
            )}
            {parsed.discounts.map((d, i) => (
              <Text key={`d${i}`} variant="small" tone="muted" style={{marginTop: space.xs}}>
                {d.label} −{formatMoney(d.amount_minor, currency)}
              </Text>
            ))}
            {parsed.charges.map((c, i) => (
              <Text key={`c${i}`} variant="small" tone="muted" style={{marginTop: space.xs}}>
                {c.label} {formatMoney(c.amount_minor, currency)}
              </Text>
            ))}
            {parsed.round_off_minor ? (
              <Text variant="small" tone="muted" style={{marginTop: space.xs}}>
                Round off {formatMoney(parsed.round_off_minor, currency)}
              </Text>
            ) : null}
            {parsed.discounts.length || parsed.charges.length || parsed.round_off_minor ? (
              <SwitchRow title="Add these discounts, charges and round-off" value={useExtras} onChange={setUseExtras} />
            ) : null}
            <Text variant="bodyStrong" style={{marginTop: space.sm}}>
              {parsed.total_minor !== null ? `Receipt total ${formatMoney(parsed.total_minor, currency)}` : 'Receipt total not found'}
            </Text>
            <Text variant="caption" tone="faint">
              The bill won't finalise until it adds up to this total, so misread lines get caught.
            </Text>
          </Card>
          <SwitchRow title="Attach the photo to the expense" subtitle="Stored privately for this group" value={attachPhoto} onChange={setAttachPhoto} />
          <Button label="Scan a different photo" variant="ghost" onPress={() => setStage('pick')} />
        </>
      ) : null}
    </Screen>
  );
}
