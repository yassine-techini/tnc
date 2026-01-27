import { useState, useCallback } from 'react';

export interface UseModalReturn<T = undefined> {
  isOpen: boolean;
  data: T | undefined;
  open: (data?: T) => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Hook for managing modal state
 * @template T - Type of data passed to modal
 */
export function useModal<T = undefined>(): UseModalReturn<T> {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<T | undefined>(undefined);

  const open = useCallback((modalData?: T) => {
    setData(modalData);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Delay clearing data to allow for close animation
    setTimeout(() => setData(undefined), 300);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  return {
    isOpen,
    data,
    open,
    close,
    toggle,
  };
}

/**
 * Hook for managing multiple modals
 */
export type ModalId = string;

export interface UseMultiModalReturn {
  openModal: (id: ModalId) => void;
  closeModal: (id: ModalId) => void;
  isModalOpen: (id: ModalId) => boolean;
  closeAll: () => void;
}

export function useMultiModal(): UseMultiModalReturn {
  const [openModals, setOpenModals] = useState<Set<ModalId>>(new Set());

  const openModal = useCallback((id: ModalId) => {
    setOpenModals((prev) => new Set(prev).add(id));
  }, []);

  const closeModal = useCallback((id: ModalId) => {
    setOpenModals((prev) => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  }, []);

  const isModalOpen = useCallback(
    (id: ModalId) => openModals.has(id),
    [openModals]
  );

  const closeAll = useCallback(() => {
    setOpenModals(new Set());
  }, []);

  return {
    openModal,
    closeModal,
    isModalOpen,
    closeAll,
  };
}

export default useModal;
