package org.campus.classroom.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.campus.classroom.common.Result;
import org.campus.classroom.dto.WaitlistCreateDTO;
import org.campus.classroom.security.LoginUser;
import org.campus.classroom.service.WaitlistService;
import org.campus.classroom.vo.WaitlistEntryVO;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/waitlist")
@RequiredArgsConstructor
@PreAuthorize("hasRole('STUDENT')")
public class WaitlistController {
    private final WaitlistService waitlistService;

    @PostMapping
    public Result<Long> create(@RequestBody @Valid WaitlistCreateDTO request,
                               @AuthenticationPrincipal LoginUser loginUser) {
        return Result.success("加入候补成功", waitlistService.createSeatWaitlist(loginUser.getId(), request));
    }

    @GetMapping("/my")
    public Result<List<WaitlistEntryVO>> listMine(@AuthenticationPrincipal LoginUser loginUser) {
        return Result.success("查询候补列表成功", waitlistService.listCurrentUserWaitlists(loginUser.getId()));
    }

    @DeleteMapping("/{id}")
    public Result<Void> cancel(@PathVariable Long id, @AuthenticationPrincipal LoginUser loginUser) {
        waitlistService.cancelWaitlist(loginUser.getId(), id);
        return Result.success("取消候补成功");
    }
}
