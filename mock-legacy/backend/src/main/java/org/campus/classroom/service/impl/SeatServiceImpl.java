package org.campus.classroom.service.impl;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.campus.classroom.dto.SeatCreateDTO;
import org.campus.classroom.dto.SeatUpdateDTO;
import org.campus.classroom.entity.Classroom;
import org.campus.classroom.entity.Seat;
import org.campus.classroom.enums.ClassroomStatus;
import org.campus.classroom.enums.ResultCode;
import org.campus.classroom.enums.SeatStatus;
import org.campus.classroom.exception.BusinessException;
import org.campus.classroom.mapper.ClassroomMapper;
import org.campus.classroom.mapper.ReservationMapper;
import org.campus.classroom.mapper.SeatMapper;
import org.campus.classroom.service.SeatService;
import org.campus.classroom.vo.ClassroomSeatLayoutVO;
import org.campus.classroom.vo.SeatVO;
import org.springframework.beans.BeanUtils;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
@Slf4j
public class SeatServiceImpl implements SeatService {
    private final SeatMapper seatMapper;
    private final ClassroomMapper classroomMapper;
    private final ReservationMapper reservationMapper;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void initSeats(Long classroomId) {
        log.info("[开始初始化座位] 教室ID={}", classroomId);
        Classroom classroom = validateClassroom(classroomId);

        List<Seat> existingSeats = seatMapper.selectByClassroomId(classroomId);
        Set<String> existingPositionKeys = new HashSet<>();
        for (Seat seat : existingSeats) {
            existingPositionKeys.add(buildSeatPositionKey(seat.getRowNumber(), seat.getColNumber()));
        }

        int createdCount = 0;
        for (int row = 1; row <= classroom.getSeatRows(); row++) {
            for (int col = 1; col <= classroom.getSeatCols(); col++) {
                if (existingPositionKeys.contains(buildSeatPositionKey(row, col))) {
                    continue;
                }
                Seat seat = new Seat();
                seat.setClassroomId(classroom.getId());
                seat.setSeatNumber(row + "-" + col);
                seat.setRowNumber(row);
                seat.setColNumber(col);
                seat.setStatus(SeatStatus.ENABLED.name());
                seatMapper.insert(seat);
                createdCount += 1;
            }
        }

        log.info("[座位初始化完成] 教室ID={}, 已有座位数={}, 新增座位数={}, 目标座位数={}",
                classroomId, existingSeats.size(), createdCount, classroom.getSeatRows() * classroom.getSeatCols());
    }

    @Override
    public SeatVO getSeatById(Long id) {
        Seat seat = seatMapper.selectById(id);
        if (seat == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "座位不存在");
        }
        return seatToSeatVO(seat);
    }

    @Override
    public ClassroomSeatLayoutVO getSeatLayout(Long classroomId) {
        Classroom classroom = validateClassroom(classroomId);
        List<SeatVO> seatVOS = seatMapper.selectByClassroomId(classroomId).stream()
                .map(this::seatToSeatVO)
                .toList();

        ClassroomSeatLayoutVO layoutVO = new ClassroomSeatLayoutVO();
        layoutVO.setClassroomId(classroomId);
        layoutVO.setClassroomBuilding(classroom.getBuilding());
        layoutVO.setClassroomNumber(classroom.getRoomNumber());
        layoutVO.setSeatCols(classroom.getSeatCols());
        layoutVO.setSeatRows(classroom.getSeatRows());
        layoutVO.setSeatVOS(seatVOS);
        return layoutVO;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public SeatVO create(Long classroomId, SeatCreateDTO request) {
        Classroom classroom = validateClassroom(classroomId);
        validateSeatPosition(classroom, request.getRowNumber(), request.getColNumber());

        String status = request.getStatus();
        if (status == null || status.trim().isEmpty()) {
            status = SeatStatus.ENABLED.name();
        }
        status = status.trim();
        validateStatus(status);

        Seat seat = new Seat();
        seat.setClassroomId(classroomId);
        seat.setSeatNumber(request.getSeatNumber().trim());
        seat.setRowNumber(request.getRowNumber());
        seat.setColNumber(request.getColNumber());
        seat.setStatus(status);
        seat.setRemark(request.getRemark());

        try {
            seatMapper.insert(seat);
        } catch (DuplicateKeyException e) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该教室下座位位置或编号已存在");
        }

        return getSeatById(seat.getId());
    }

    @Override
    public Boolean update(Long id, SeatUpdateDTO request) {
        Seat existing = seatMapper.selectById(id);
        if (existing == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "座位不存在");
        }

        String status = request.getStatus();
        if (status == null || status.trim().isEmpty()) {
            status = existing.getStatus();
        }
        status = status.trim();
        validateStatus(status);

        Seat seat = new Seat();
        seat.setId(id);
        seat.setClassroomId(existing.getClassroomId());
        seat.setSeatNumber(existing.getSeatNumber());
        seat.setRowNumber(existing.getRowNumber());
        seat.setColNumber(existing.getColNumber());
        seat.setStatus(status);
        seat.setRemark(request.getRemark());
        seatMapper.updateById(seat);
        return true;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public Boolean delete(Long id) {
        Seat existing = seatMapper.selectById(id);
        if (existing == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "座位不存在");
        }
        validateClassroom(existing.getClassroomId());

        int activeReservationCount = reservationMapper.countActiveReservationsBySeatId(id);
        if (activeReservationCount > 0) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该座位存在有效预约，不能删除");
        }

        int rows = seatMapper.deleteById(id);
        if (rows <= 0) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "座位删除失败");
        }
        return true;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public Boolean batchUpdateSeats(Long classroomId, SeatUpdateDTO request) {
        validateClassroom(classroomId);

        String status = request.getStatus();
        if (status == null || status.trim().isEmpty()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "状态不能为空");
        }
        status = status.trim();
        validateStatus(status);

        int rows = seatMapper.batchUpdateByClassroomId(classroomId, status, request.getRemark());
        if (rows < 1) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "未更新到任何座位");
        }
        return true;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public Boolean batchDeleteSeats(Long classroomId) {
        validateClassroom(classroomId);

        int rows = seatMapper.batchDeleteByClassroomId(classroomId);
        if (rows <= 0) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "未删除任何座位");
        }
        return true;
    }

    private void validateStatus(String status) {
        if (!SeatStatus.ENABLED.name().equals(status)
                && !SeatStatus.DISABLED.name().equals(status)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "状态只能是启用或禁用");
        }
    }

    private Classroom validateClassroom(Long classroomId) {
        Classroom classroom = classroomMapper.selectById(classroomId);
        if (classroom == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "教室不存在");
        }
        if (!ClassroomStatus.ENABLED.name().equals(classroom.getStatus())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "教室不可用");
        }
        return classroom;
    }

    private void validateSeatPosition(Classroom classroom, Integer rowNumber, Integer colNumber) {
        if (rowNumber == null || colNumber == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "座位行号和列号不能为空");
        }
        if (rowNumber < 1 || rowNumber > classroom.getSeatRows()
                || colNumber < 1 || colNumber > classroom.getSeatCols()) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "座位行列超出教室布局范围");
        }
    }

    private String buildSeatPositionKey(Integer rowNumber, Integer colNumber) {
        return rowNumber + "-" + colNumber;
    }

    private SeatVO seatToSeatVO(Seat seat) {
        SeatVO seatVO = new SeatVO();
        BeanUtils.copyProperties(seat, seatVO);
        return seatVO;
    }
}
