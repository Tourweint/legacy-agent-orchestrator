package org.campus.classroom.service;

import org.campus.classroom.dto.WaitlistCreateDTO;
import org.campus.classroom.vo.WaitlistEntryVO;

import java.util.List;

public interface WaitlistService {
    Long createSeatWaitlist(Long currentUserId, WaitlistCreateDTO request);

    List<WaitlistEntryVO> listCurrentUserWaitlists(Long currentUserId);

    void cancelWaitlist(Long currentUserId, Long waitlistId);
}
